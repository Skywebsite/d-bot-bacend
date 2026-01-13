const mongoose = require('mongoose');
const { SYSTEM_PROMPT, formatEventsContext } = require('./ai.prompt');

/**
 * AI Configuration for Eden AI
 */
const CONFIG = {
    apiKey: process.env.OPENAI_API_KEY,
    chatProvider: process.env.AI_PROVIDER || 'google',
    llmModel: process.env.LLM_MODEL || 'gemini-1.5-flash',
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.edenai.run/v2'
};

/**
 * ---------------------------------------------------------
 *  INTENT RECOGNITION (Simple Dialogflow-like Logic)
 * ---------------------------------------------------------
 */
const detectIntent = async (question) => {
    const q = question.toLowerCase();

    // 1. GREETING INTENT
    if (q.match(/^(hi|hello|hey|greetings|good morning|good evening)/)) {
        return {
            answer: "Hello! 👋 I'm D-Bot. I can help you find events, check dates, or discover fun things to do. What are you looking for?",
            sources: []
        };
    }

    // 2. LIST ALL EVENTS INTENT
    if (q.includes('all events') || q.includes('show events') || q.match(/^events$/)) {
        const events = await mongoose.connection.collection('events').find({}).limit(10).toArray();
        return {
            answer: "Here are the latest events I found for you! 📅",
            sources: events
        };
    }

    // 3. HELP INTENT
    if (q.includes('help') || q.includes('what can you do')) {
        return {
            answer: "I'm here to help you discover events! 🕵️‍♂️\n\nYou can ask me things like:\n- 'Show me upcoming music festivals'\n- 'Are there any free events?'\n- 'What's happening in Borcelle?'",
            sources: []
        };
    }

    return null; // No specific intent matched
};


/**
 * Generate embedding for a given text using Eden AI.
 */
const generateEmbedding = async (text) => {
    try {
        const response = await fetch(`${CONFIG.baseUrl}/text/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providers: CONFIG.embeddingProvider,
                texts: [text],
                [CONFIG.embeddingProvider]: CONFIG.embeddingModel
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("[Eden AI Embedding Error Body]:", JSON.stringify(data, null, 2));
            throw new Error(`Eden AI Embedding HTTP ${response.status}: ${data.error || 'Check logs'}`);
        }

        const providerKey = Object.keys(data).find(key => data[key]?.status === 'success');
        const providerData = data[providerKey];

        if (providerData && providerData.items?.length > 0) {
            return providerData.items[0].embedding;
        }

        throw new Error(`Invalid embedding format from Eden AI: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error("[AI Error] Could not generate embedding:", error.message);
        return null; // Return null so we can fallback to normal search
    }
};

/**
 * Perform Vector Search in MongoDB Atlas with Fallback
 */
const retrieveRelevantEvents = async (queryEmbedding, queryText, limit = 5) => {
    try {
        let vectorResults = [];
        let keywordResults = [];

        // 1. Vector Search (if embedding exists)
        if (queryEmbedding) {
            try {
                vectorResults = await mongoose.connection.collection('events').aggregate([
                    {
                        $vectorSearch: {
                            index: "vector_index",
                            path: "embedding",
                            queryVector: queryEmbedding,
                            numCandidates: 100,
                            limit: limit
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            event_details: 1,
                            full_text: 1,
                            raw_ocr: 1,
                            score: { $meta: "vectorSearchScore" }
                        }
                    }
                ]).toArray();
            } catch (err) {
                console.warn("[Search Warning] Vector search failed (likely missing index). Ignoring vector results.", err.message);
            }
        }

        // 2. Keyword Search (Regex) - Critical for records without embeddings
        if (queryText) {
            const searchRegex = new RegExp(queryText, 'i');
            keywordResults = await mongoose.connection.collection('events').find({
                $or: [
                    { "event_details.event_name": searchRegex }, // Corrected field name
                    { "event_details.place": searchRegex },
                    { "full_text": searchRegex } // Search full extracted text
                ]
            }).limit(limit).toArray();
        }

        // 3. Merge and Deduplicate
        const allResults = [...vectorResults, ...keywordResults];
        const uniqueResults = [];
        const seenIds = new Set();

        for (const result of allResults) {
            const idStr = result._id.toString();
            if (!seenIds.has(idStr)) {
                seenIds.add(idStr);
                uniqueResults.push(result);
            }
        }

        // Limit final set
        return uniqueResults.slice(0, limit);

    } catch (error) {
        console.warn("[Search Warning] Retrieval failed. Falling back to simple latest events:", error.message);
        return await mongoose.connection.collection('events').find({}).limit(limit).toArray();
    }
};

/**
 * Main chat logic: RAG approach using Eden AI
 */
const getChatResponse = async (question) => {
    try {
        // -------------------------------------------------
        // 1. Check Local Intents First (Dialogflow-like)
        // -------------------------------------------------
        const intentResult = await detectIntent(question);
        if (intentResult) {
            console.log("[AI Service] Intent matched locally.");
            return intentResult;
        }

        // -------------------------------------------------
        // 2. Fallback to RAG (Embeddings + LLM)
        // -------------------------------------------------

        // Generate Query Vector (Optional fallback)
        const queryEmbedding = await generateEmbedding(question);

        // 2. Search Database (with fallback to basic retrieval)
        const relevantEvents = await retrieveRelevantEvents(queryEmbedding, question);

        // 3. Prepare Context
        const eventsContext = formatEventsContext(relevantEvents);

        // 4. Generate Answer using Eden AI Chat
        try {
            const response = await fetch(`${CONFIG.baseUrl}/text/chat`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    providers: CONFIG.chatProvider,
                    text: question,
                    chatbot_global_action: SYSTEM_PROMPT.replace('{eventsContext}', eventsContext),
                    temperature: 0.2,
                    max_tokens: 1000,
                    [CONFIG.chatProvider]: CONFIG.llmModel
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("[Eden AI Chat Error Body]:", JSON.stringify(data, null, 2));
                throw new Error(`Eden AI Chat HTTP ${response.status}`);
            }

            const providerKey = Object.keys(data).find(key => data[key]?.status === 'success');
            const providerData = data[providerKey];

            if (providerData && providerData.status === 'success') {
                return {
                    answer: providerData.generated_text,
                    sources: relevantEvents
                };
            }
        } catch (chatError) {
            console.warn("[AI Service Warning] Chat generation failed. Returning fallback response.", chatError.message);
            // Fallback: If LLM fails, return the raw events with a simple message
            return {
                answer: "I'm having a little trouble thinking of a witty response right now, but here are the events I found for you! 👇",
                sources: relevantEvents
            };
        }

        throw new Error(`Invalid chat format from Eden AI.`);
    } catch (error) {
        console.error("[AI Service Error]:", error.message);
        // Final Safety Net: Standard Search
        return await performStandardSearch(question);
    }
};

/**
 * Standard Text Search without AI
 * Uses regex to find matching events in the database.
 */
const performStandardSearch = async (query) => {
    try {
        console.log(`[Standard Search] Searching for: "${query}"`);

        // Create a case-insensitive regex for the search query
        const searchRegex = new RegExp(query, 'i');

        const results = await mongoose.connection.collection('events').find({
            $or: [
                { "event_details.event_name": searchRegex },
                { "event_details.place": searchRegex },
                { "full_text": searchRegex } // Search full text instead of raw_ocr array
            ]
        }).limit(10).toArray();

        return {
            answer: results.length > 0
                ? `Found ${results.length} events matching "${query}".`
                : `No events found matching "${query}".`,
            sources: results
        };
    } catch (error) {
        console.error("[Standard Search Error]:", error.message);
        throw error;
    }
};

module.exports = {
    getChatResponse,
    performStandardSearch
};
