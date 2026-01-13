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
    if (q.includes('all events') || q.includes('show events') || q.includes('any events') || q.includes('latest events') || q.match(/^events$/)) {
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
 * Helper function to calculate event quality score
 * Returns a score from 0-100 based on how complete the event data is
 */
const calculateEventQuality = (event) => {
    const details = event.event_details || {};
    let score = 0;

    // Check each field and add points if it's not N/A or empty
    if (details.event_name && details.event_name !== 'N/A' && details.event_name.trim().length > 0) score += 30;
    if (details.event_date && details.event_date !== 'N/A' && details.event_date.trim().length > 0) score += 25;
    if (details.location && details.location !== 'N/A' && details.location.trim().length > 0) score += 20;
    if (details.event_time && details.event_time !== 'N/A' && details.event_time.trim().length > 0) score += 10;
    if (details.organizer && details.organizer !== 'N/A' && details.organizer.trim().length > 0) score += 10;
    if (details.website && details.website !== 'N/A' && details.website.trim().length > 0) score += 5;

    return score;
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
                            limit: limit * 2 // Get more candidates for filtering
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

        // 2. Keyword Search (Regex) - Fallback for when Vector Search fails or is insufficient
        if (queryText) {
            // "Smart" Keyword Extraction: Remove stop words to find core terms
            const stopWords = ['show', 'me', 'any', 'event', 'events', 'of', 'in', 'for', 'the', 'a', 'an', 'find', 'search', 'about', 'is', 'are', 'which', 'what', 'when', 'where'];
            const tokens = queryText.toLowerCase().split(/[\s,.?!]+/); // Split by space or punctuation
            const keywords = tokens.filter(t => t.length > 2 && !stopWords.includes(t));

            // If we extracted valid keywords, search for ANY of them (broad match)
            if (keywords.length > 0) {
                const keywordConditions = keywords.map(kw => {
                    const regex = new RegExp(kw, 'i');
                    return [
                        { "event_details.event_name": regex },
                        { "event_details.location": regex },
                        { "event_details.event_date": regex },
                        { "full_text": regex },
                        { "raw_ocr.text": regex } // Also check raw OCR words
                    ];
                }).flat();

                keywordResults = await mongoose.connection.collection('events').find({
                    $or: keywordConditions
                }).limit(limit * 2).toArray(); // Get more candidates for filtering

                console.log(`[Smart Search] Keywords: [${keywords.join(', ')}] -> Found ${keywordResults.length} raw matches.`);
            } else {
                // Determine if we should fallback to the original whole-phrase search
                // (Useful if the user searched for something very short or specific that was filtered out)
                const searchRegex = new RegExp(queryText, 'i');
                keywordResults = await mongoose.connection.collection('events').find({
                    $or: [
                        { "event_details.event_name": searchRegex },
                        { "event_details.location": searchRegex },
                        { "event_details.event_date": searchRegex },
                        { "full_text": searchRegex }
                    ]
                }).limit(limit * 2).toArray();
            }
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

        // 4. Filter by quality - only keep events with quality score >= 50
        const qualityFiltered = uniqueResults.filter(event => {
            const quality = calculateEventQuality(event);
            return quality >= 50; // Must have at least name + date or name + location
        });

        console.log(`[Quality Filter] ${uniqueResults.length} unique results -> ${qualityFiltered.length} quality events`);

        // 5. Sort by quality score (higher is better)
        qualityFiltered.sort((a, b) => calculateEventQuality(b) - calculateEventQuality(a));

        // 6. Limit final set
        const finalResults = qualityFiltered.slice(0, limit);

        // If we have no quality results, return empty array instead of low-quality events
        return finalResults.length > 0 ? finalResults : [];

    } catch (error) {
        console.warn("[Search Warning] Retrieval failed:", error.message);
        return [];
    }
};

/**
 * Helper function to detect if a question is a follow-up question
 */
const isFollowUpQuestion = (question, conversationHistory = []) => {
    const q = question.toLowerCase().trim();

    // If the question is very short (1-3 words) and there's conversation history, likely a follow-up
    const wordCount = q.split(/\s+/).length;
    if (wordCount <= 3 && conversationHistory.length > 0) {
        // Check if it contains question-like words or detail-seeking words
        const detailWords = ['date', 'time', 'location', 'place', 'contact', 'number', 'phone', 'email',
            'website', 'address', 'price', 'cost', 'when', 'where', 'who', 'what',
            'which', 'how', 'their', 'they', 'its', 'the'];
        const hasDetailWord = detailWords.some(word => q.includes(word));
        if (hasDetailWord) {
            console.log(`[Follow-up Detection] Short question with detail word: "${question}"`);
            return true;
        }
    }

    // Common follow-up patterns
    const followUpPatterns = [
        // Standard question patterns
        /^(which|what|when|where|who|whose)\s+(date|time|location|place|contact|number|price|cost|website|email|phone)/i,

        // "the X" patterns
        /^(the\s+)?(date|time|location|place|contact|number|price|cost|website|email|phone|address)/i,

        // Possessive patterns (their, its, his, her)
        /^(their|its|his|her|they)\s+/i,

        // Direct detail words at start
        /^(contact|phone|email|website|address|price|cost|date|time|location|place)/i,

        // How questions
        /^(how much|how long|how many|how far)/i,

        // "X number" or "X details" patterns
        /(contact|phone)\s*(number|details|info)?$/i,

        // Very short contextual questions
        /^(when|where|who|what time|what date)/i
    ];

    const isFollowUp = followUpPatterns.some(pattern => pattern.test(q));

    if (isFollowUp) {
        console.log(`[Follow-up Detection] Pattern matched: "${question}"`);
    }

    return isFollowUp;
};

/**
 * Extract event sources from conversation history
 */
const extractEventsFromHistory = (conversationHistory) => {
    // Look for the last AI message that might have included event sources
    // In a real implementation, we'd need to store sources with messages
    // For now, we'll return empty array and rely on the AI's memory
    return [];
};

/**
 * Main chat logic: RAG approach using Eden AI
 */
const getChatResponse = async (question, conversationHistory = []) => {
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
        // 2. Check if this is a follow-up question
        // -------------------------------------------------
        const isFollowUp = isFollowUpQuestion(question, conversationHistory);
        let relevantEvents = [];

        if (isFollowUp && conversationHistory.length > 0) {
            console.log("[AI Service] Detected follow-up question. Using conversation context only.");
            // For follow-up questions, don't search for new events
            // The AI will use the conversation history to answer
            relevantEvents = [];
        } else {
            // -------------------------------------------------
            // 3. Perform RAG (Embeddings + LLM) for new queries
            // -------------------------------------------------

            // Generate Query Vector (Optional fallback)
            const queryEmbedding = await generateEmbedding(question);

            // Search Database (with fallback to basic retrieval)
            relevantEvents = await retrieveRelevantEvents(queryEmbedding, question);
        }

        // 4. Prepare Context
        const eventsContext = formatEventsContext(relevantEvents);

        // 5. Build conversation context from history
        let conversationContext = '';
        if (conversationHistory && conversationHistory.length > 0) {
            // Take last 6 messages (3 turns) to keep context manageable
            const recentHistory = conversationHistory.slice(-6);
            conversationContext = '\n\nPrevious Conversation:\n' +
                recentHistory.map(msg => {
                    const role = msg.role === 'user' ? 'User' : 'D-Bot';
                    return `${role}: ${msg.content}`;
                }).join('\n');
        }

        // 6. Generate Answer using Eden AI Chat
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
                    chatbot_global_action: SYSTEM_PROMPT.replace('{eventsContext}', eventsContext) + conversationContext,
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
                    sources: isFollowUp ? [] : relevantEvents // Don't show event cards for follow-up questions
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
