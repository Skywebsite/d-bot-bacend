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
 * Helper function to extract user name from response
 */
const extractUserName = (text) => {
    // Remove common prefixes and clean up
    let name = text.trim();
    // Remove "my name is", "i'm", "i am", "it's", "it is" etc.
    name = name.replace(/^(my name is|i'?m|i am|it'?s|it is|this is|call me|name'?s)\s+/i, '');
    // Remove trailing punctuation
    name = name.replace(/[.,!?]+$/, '');
    // Take first word or first few words (max 3 words for name)
    const words = name.split(/\s+/).slice(0, 3);
    return words.join(' ').trim();
};

/**
 * Extract user name from conversation history
 */
const getUserName = (conversationHistory) => {
    // Look through conversation history for name
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role === 'user') {
            // Check if previous AI message was asking for name
            if (i > 0 && conversationHistory[i - 1].role === 'ai') {
                const prevAIMsg = conversationHistory[i - 1].content.toLowerCase();
                if (prevAIMsg.includes('what is ur name') || 
                    prevAIMsg.includes('what is your name') ||
                    prevAIMsg.includes("what's your name")) {
                    return extractUserName(msg.content);
                }
            }
        }
    }
    return null;
};

/**
 * Check if we should ask for user's name
 */
const shouldAskForName = (conversationHistory) => {
    if (!conversationHistory || conversationHistory.length === 0) {
        return false;
    }

    // Check if user has already provided their name
    const existingName = getUserName(conversationHistory);
    if (existingName) {
        return false; // Already have name
    }

    // Count user messages - if this is the first user message, ask for name
    const userMessages = conversationHistory.filter(msg => msg.role === 'user');
    
    // If this is the first user message (only 1 user message in history)
    if (userMessages.length === 1) {
        // Check if we already asked for name in any AI message
        const hasAskedForName = conversationHistory.some(msg => 
            msg.role === 'ai' && 
            (msg.content.toLowerCase().includes('what is ur name') || 
             msg.content.toLowerCase().includes('what is your name') ||
             msg.content.toLowerCase().includes("what's your name"))
        );
        if (!hasAskedForName) {
            console.log("[Name Check] First user message detected, asking for name");
            return true;
        }
    }
    
    return false;
};

/**
 * Check if user just provided their name
 */
const isNameResponse = (conversationHistory) => {
    if (conversationHistory.length >= 2) {
        const lastAIMessage = conversationHistory[conversationHistory.length - 2];
        if (lastAIMessage.role === 'ai' && 
            (lastAIMessage.content.toLowerCase().includes('what is ur name') || 
             lastAIMessage.content.toLowerCase().includes('what is your name') ||
             lastAIMessage.content.toLowerCase().includes("what's your name"))) {
            return true;
        }
    }
    return false;
};

/**
 * ---------------------------------------------------------
 *  INTENT RECOGNITION (Simple Dialogflow-like Logic)
 * ---------------------------------------------------------
 */
const detectIntent = async (question, conversationHistory = []) => {
    const q = question.toLowerCase();

    // 1. GREETING INTENT - Don't return greeting message, let name asking logic handle it
    // The greeting is already shown initially, so we just skip intent matching for greetings
    // and let the name asking logic handle first interactions
    if (q.match(/^(hi|hello|hey|greetings|good morning|good evening)/)) {
        // Return null so name asking logic can handle it
        return null;
    }

    // 2. LIST ALL EVENTS INTENT
    if (q.includes('all events') || q.includes('show events') || q.includes('any events') || q.includes('latest events') || q.match(/^events$/)) {
        // For "latest events", sort by _id descending (newest first) since MongoDB ObjectId contains timestamp
        // For other queries, just get events without specific sorting
        const sortOrder = q.includes('latest') ? { _id: -1 } : {};
        const events = await mongoose.connection.collection('events')
            .find({})
            .sort(sortOrder)
            .limit(50)
            .toArray();
        return {
            answer: q.includes('latest') 
                ? `Here are the ${events.length} most recently posted events! 📅`
                : `Here are ${events.length} events I found for you! 📅`,
            sources: events
        };
    }

    // 3. HELP INTENT - Expanded to catch more variations
    if (q.includes('help') || 
        q.includes('what can you do') || 
        q.includes('what do you do') ||
        q.includes('what u do') ||
        q.includes('what can u do') ||
        q.match(/what.*do/) ||
        q.match(/what.*can/) ||
        q === 'what u do' ||
        q === 'what do you do' ||
        q === 'what can you do') {
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

    // Check event name - reject very short or generic names
    const eventName = (details.event_name || '').trim();
    if (eventName && eventName !== 'N/A' && eventName.length > 0) {
        // Penalize very short names (like "THE", "WOODRUFF")
        if (eventName.length <= 3 && !eventName.match(/^[A-Z]{2,3}$/)) {
            score -= 20; // Heavy penalty for generic short names
        }
        // Only add points if name is meaningful (more than 3 chars or is a proper acronym)
        if (eventName.length > 3 || eventName.match(/^[A-Z]{2,4}$/)) {
            score += 30;
        }
    }
    
    if (details.event_date && details.event_date !== 'N/A' && details.event_date.trim().length > 0) score += 25;
    if (details.location && details.location !== 'N/A' && details.location.trim().length > 0) score += 20;
    if (details.event_time && details.event_time !== 'N/A' && details.event_time.trim().length > 0) score += 10;
    if (details.organizer && details.organizer !== 'N/A' && details.organizer.trim().length > 0) score += 10;
    if (details.website && details.website !== 'N/A' && details.website.trim().length > 0) score += 5;

    return Math.max(0, score); // Don't return negative scores
};

/**
 * Perform Vector Search in MongoDB Atlas with Fallback
 */
const retrieveRelevantEvents = async (queryEmbedding, queryText, limit = 20) => {
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

        // 3. Merge and Deduplicate by ID and name
        const allResults = [...vectorResults, ...keywordResults];
        const uniqueResults = [];
        const seenIds = new Set();
        const seenNames = new Set();

        for (const result of allResults) {
            const idStr = result._id.toString();
            const eventName = (result.event_details?.event_name || '').toLowerCase().trim();
            
            // Skip if we've seen this ID before
            if (seenIds.has(idStr)) {
                continue;
            }
            
            // Skip if event name is too short or generic (like "THE", "WOODRUFF" without context)
            if (eventName.length <= 3 && !eventName.match(/^[a-z]{3,}$/)) {
                continue;
            }
            
            // Skip duplicates with same normalized name
            const normalizedName = eventName.replace(/[^a-z0-9]/g, '');
            if (normalizedName && seenNames.has(normalizedName)) {
                continue;
            }
            
            seenIds.add(idStr);
            if (normalizedName) {
                seenNames.add(normalizedName);
            }
            uniqueResults.push(result);
        }

        // 4. Filter by quality - only keep events with quality score >= 50
        // This ensures we have meaningful event names (not just "THE" or single words)
        const qualityFiltered = uniqueResults.filter(event => {
            const quality = calculateEventQuality(event);
            const eventName = (event.event_details?.event_name || '').trim();
            // Additional check: reject events with names that are too short or generic
            if (eventName.length <= 3 && !eventName.match(/^[A-Z]{2,3}$/)) {
                return false;
            }
            return quality >= 50; // Must have meaningful name + date or name + location
        });

        console.log(`[Quality Filter] ${uniqueResults.length} unique results -> ${qualityFiltered.length} quality events`);
        
        // If quality filter is too strict and we have no results, try a more lenient filter
        if (qualityFiltered.length === 0 && uniqueResults.length > 0) {
            console.log("[Quality Filter] No events passed strict filter, trying lenient filter (score >= 40)");
            const lenientFiltered = uniqueResults.filter(event => {
                const quality = calculateEventQuality(event);
                const eventName = (event.event_details?.event_name || '').trim();
                // Still reject very short names
                if (eventName.length <= 2) {
                    return false;
                }
                return quality >= 40; // More lenient threshold
            });
            
            if (lenientFiltered.length > 0) {
                console.log(`[Quality Filter] Lenient filter found ${lenientFiltered.length} events`);
                lenientFiltered.sort((a, b) => calculateEventQuality(b) - calculateEventQuality(a));
                return lenientFiltered.slice(0, limit);
            }
        }

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

    // Check if question references an event from conversation history
    // Look for event names or locations mentioned in previous messages
    if (conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-6).map(msg => msg.content.toLowerCase()).join(' ');
        const eventKeywords = ['event', 'festival', 'concert', 'show', 'stadium', 'venue', 'location', 'uppal', 'holi', 'colour'];
        const hasEventReference = eventKeywords.some(keyword => recentMessages.includes(keyword));
        
        // If question asks about something and there's an event in recent history, likely a follow-up
        const isAskingAboutEvent = (
            q.includes('tell me more') ||
            q.includes('more about') ||
            q.includes('about the') ||
            q.includes('about this') ||
            q.includes('about that') ||
            q.includes('about') ||
            q.match(/^(tell|give|show|what).*(more|details|info|about)/i)
        );
        
        if (hasEventReference && isAskingAboutEvent) {
            console.log(`[Follow-up Detection] Question references event from history: "${question}"`);
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
        /^(when|where|who|what time|what date)/i,

        // "Tell me more" patterns
        /^(tell|give|show).*(more|details|info|about)/i,
        /more\s+about/i,
        /about\s+(the|this|that|it)/i
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
 * Smart fallback: Extract answer from conversation history for follow-up questions
 */
const extractAnswerFromHistory = (question, conversationHistory) => {
    if (!conversationHistory || conversationHistory.length < 2) {
        console.log("[Fallback] No conversation history available");
        return null;
    }

    const q = question.toLowerCase().trim();
    console.log(`[Fallback] Looking for answer to: "${q}"`);
    console.log(`[Fallback] Conversation history has ${conversationHistory.length} messages`);
    
    // Look for the most recent AI message that mentioned events
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role === 'ai' && msg.content) {
            const content = msg.content;
            const contentLower = content.toLowerCase();
            console.log(`[Fallback] Checking AI message ${i}: "${content.substring(0, 100)}..."`);
            
            // Check if this message contains location information
            if (content.includes('at ') || content.includes('At ')) {
                console.log(`[Fallback] Found message with 'at': "${content}"`);
            }
            
            // For "tell me about that" or "tell about that" or "can u tell about that" - return the full previous response
            // Also handle variations like "can u tell", "tell me", "tell about"
            const tellPatterns = [
                /tell.*about/i,
                /tell.*that/i,
                /tell.*it/i,
                /tell.*this/i,
                /say.*about/i,
                /can.*tell/i,
                /could.*tell/i
            ];
            
            const hasTellPattern = tellPatterns.some(pattern => pattern.test(q));
            const hasAboutThat = q.includes('about') || q.includes('that') || q.includes('it') || q.includes('this');
            
            if ((q.includes('tell') || q.includes('say') || hasTellPattern) && hasAboutThat) {
                // Return the full previous AI response about the event
                // This gives the user all the details that were previously mentioned
                if (content.length > 30) {
                    console.log("[Fallback] Returning previous AI response for 'tell about' question");
                    return content; // Return the full previous response about the event
                }
            }
            
            // Extract time information
            if (q.includes('time') || (q.includes('when') && !q.includes('date'))) {
                // Look for time patterns in the AI's previous response
                const timePatterns = [
                    /(\d{1,2}\s*(?:am|pm|AM|PM)\s*(?:to|-)?\s*\d{1,2}\s*(?:am|pm|AM|PM))/i,
                    /(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?\s*(?:to|-)?\s*\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?)/i,
                    /(\d{1,2}\s*(?:pm|PM|am|AM)\s*to\s*\d{1,2}\s*(?:pm|PM|am|AM))/i,
                    /from\s*(\d{1,2}\s*(?:am|pm|AM|PM)|\d{1,2}:\d{2})\s*to\s*(\d{1,2}\s*(?:am|pm|AM|PM)|\d{1,2}:\d{2})/i
                ];
                
                for (const pattern of timePatterns) {
                    const timeMatch = content.match(pattern);
                    if (timeMatch) {
                        return `The event is scheduled ${timeMatch[0]}.`;
                    }
                }
            }
            
            // Extract contact information
            if (q.includes('contact') || (q.includes('who') && q.includes('contact')) || q.includes('organizer')) {
                const contactPatterns = [
                    /contact.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
                    /email.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
                    /phone.*?(\d{10,})/i,
                    /call.*?(\d{10,})/i
                ];
                
                for (const pattern of contactPatterns) {
                    const contactMatch = content.match(pattern);
                    if (contactMatch) {
                        return `You can contact them at ${contactMatch[1]}.`;
                    }
                }
            }
            
            // Extract location
            if (q.includes('where') || q.includes('location') || q.includes('venue') || q.includes('place')) {
                const locationPatterns = [
                    // "at Elements Cafe" - case insensitive, more flexible
                    /\bat\s+([A-Za-z][A-Za-z\s]+)/i,
                    // "happening at Elements Cafe"
                    /happening\s+(?:at|in)\s+([A-Za-z][A-Za-z\s]+)/i,
                    // "located at", "takes place at"
                    /(?:located|takes place)\s+(?:at|in)\s+([A-Za-z][A-Za-z\s]+)/i,
                    // "venue:", "location:"
                    /(?:venue|location|place):\s*([A-Za-z][A-Za-z\s]+)/i,
                    // "at [Location Name]" with venue types - case insensitive
                    /(?:at|venue|location|place)\s+([A-Za-z][A-Za-z\s]*(?:cafe|stadium|hall|center|theater|park|venue|arena|auditorium|ground|hotel|restaurant|club|bar|studio|gallery|mall|plaza|square|garden|beach|resort|academy|institute|school|college|university|library|museum|theatre|cinema|field|grounds?))/i
                ];
                
                for (let j = 0; j < locationPatterns.length; j++) {
                    const pattern = locationPatterns[j];
                    const locationMatch = content.match(pattern);
                    console.log(`[Fallback] Pattern ${j}: ${pattern} -> Match: ${locationMatch ? locationMatch[1] : 'none'}`);
                    
                    if (locationMatch && locationMatch[1]) {
                        let location = locationMatch[1].trim();
                        // Clean up trailing punctuation and extra words
                        location = location.replace(/[.,!?;:]+.*$/, '').trim();
                        location = location.split(/[.,!?]/)[0].trim();
                        
                        // Make sure it's not too short and looks like a location
                        const skipWords = ['the', 'a', 'an', 'at', 'in', 'on', 'for', 'to', 'from', 'and', 'or', 'but', 'it', 'is', 'was', 'are', 'were'];
                        const locationLower = location.toLowerCase();
                        
                        if (location.length > 2 && !skipWords.includes(locationLower)) {
                            console.log(`[Fallback] Extracted location (pattern ${j}): "${location}"`);
                            return `The event is happening at ${location}.`;
                        }
                    }
                }
                
                // Fallback: Look for capitalized words after "at" that might be locations
                // This pattern specifically looks for "at [Capitalized Word] [Capitalized Word]"
                const atLocationMatch = content.match(/\bat\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
                if (atLocationMatch && atLocationMatch[1]) {
                    let location = atLocationMatch[1].trim();
                    location = location.replace(/[.,!?;:]+$/, '').trim();
                    if (location.length > 3 && location.match(/^[A-Z]/)) {
                        console.log(`[Fallback] Extracted location (broad match): "${location}"`);
                        return `The event is happening at ${location}.`;
                    }
                }
                
                // Additional fallback: Look for any capitalized phrase after "at"
                const simpleAtMatch = content.match(/\bat\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)/);
                if (simpleAtMatch && simpleAtMatch[1]) {
                    let location = simpleAtMatch[1].trim();
                    location = location.replace(/[.,!?;:]+$/, '').trim();
                    // Stop at common sentence endings
                    location = location.split(/[.,!?]/)[0].trim();
                    if (location.length > 3 && location.match(/^[A-Z]/)) {
                        console.log(`[Fallback] Extracted location (simple match): "${location}"`);
                        return `The event is happening at ${location}.`;
                    }
                }
            }
            
            // Extract date
            if (q.includes('date') || (q.includes('when') && q.includes('date'))) {
                const datePatterns = [
                    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
                    /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
                    /on\s+(\w+\s+\d{1,2})/i
                ];
                
                for (const pattern of datePatterns) {
                    const dateMatch = content.match(pattern);
                    if (dateMatch) {
                        return `The event is on ${dateMatch[0]}.`;
                    }
                }
            }
        }
    }
    
    return null;
};

/**
 * Main chat logic: RAG approach using Eden AI
 */
const getChatResponse = async (question, conversationHistory = [], user = null) => {
    // Declare relevantEvents at function scope so it's accessible in catch block
    let relevantEvents = [];
    
    try {
        // -------------------------------------------------
        // 0. Check if we should ask for name (first interaction)
        // Skip if user is logged in (has displayName from Firebase)
        // -------------------------------------------------
        if (!user && shouldAskForName(conversationHistory)) {
            console.log("[Name Check] Asking for user's name");
            return {
                answer: "what is ur name",
                sources: []
            };
        }

        // -------------------------------------------------
        // 0.5. Check if user just provided their name
        // Skip if user is logged in (already has name from Firebase)
        // -------------------------------------------------
        if (!user && isNameResponse(conversationHistory)) {
            const userName = extractUserName(question);
            if (userName && userName.length > 0) {
                return {
                    answer: `Nice to meet you, ${userName}! 😊 Now, how can I help you with events today?`,
                    sources: []
                };
            }
        }

        // -------------------------------------------------
        // 1. Check Local Intents First (Dialogflow-like)
        // -------------------------------------------------
        const intentResult = await detectIntent(question, conversationHistory);
        if (intentResult) {
            console.log("[AI Service] Intent matched locally.");
            return intentResult;
        }

        // Get user name from Firebase auth or conversation history for personalization
        const userName = user?.displayName || getUserName(conversationHistory);

        // -------------------------------------------------
        // 2. Check if this is a follow-up question
        // -------------------------------------------------
        const isFollowUp = isFollowUpQuestion(question, conversationHistory);

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
            // Take last 10 messages (5 turns) to keep more context
            const recentHistory = conversationHistory.slice(-10);
            conversationContext = '\n\n=== Previous Conversation ===\n' +
                recentHistory.map(msg => {
                    const role = msg.role === 'user' ? 'User' : 'D-Bot';
                    return `${role}: ${msg.content}`;
                }).join('\n') + '\n=== End of Previous Conversation ===\n';
        }

        // Add user name to context if available
        if (userName) {
            conversationContext += `\nNote: The user's name is ${userName}. You can use their name to personalize responses when appropriate.\n`;
        }

        // Build the complete system prompt with all context
        const fullSystemPrompt = SYSTEM_PROMPT.replace('{eventsContext}', eventsContext) + conversationContext;

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
                    chatbot_global_action: fullSystemPrompt,
                    temperature: 0.2,
                    max_tokens: 1500, // Increased to allow longer responses with context
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
            
            // If no successful provider found, log and use fallback
            console.warn("[AI Service Warning] No successful provider found in Eden AI response:", JSON.stringify(data, null, 2));
            
            // For follow-up questions, try to extract answer from conversation history
            if (isFollowUp) {
                console.log("[Fallback] Attempting to extract answer from conversation history for:", question);
                const extractedAnswer = extractAnswerFromHistory(question, conversationHistory);
                if (extractedAnswer) {
                    console.log("[Fallback] Successfully extracted answer from history");
                    return {
                        answer: extractedAnswer,
                        sources: []
                    };
                } else {
                    console.log("[Fallback] Could not extract answer from history, using default message");
                }
            }
            
            // Fallback: Generate a simple response from events found (when AI is down)
            if (!isFollowUp && relevantEvents.length > 0) {
                // Generate a simple text response from the events
                const eventSummary = relevantEvents.slice(0, 3).map((event, idx) => {
                    const details = event.event_details || {};
                    const name = details.event_name || 'Event';
                    const date = details.event_date && details.event_date !== 'N/A' ? details.event_date : '';
                    const location = details.location && details.location !== 'N/A' ? details.location : '';
                    const time = details.event_time && details.event_time !== 'N/A' ? details.event_time : '';
                    
                    let summary = `${idx + 1}. ${name}`;
                    if (date) summary += ` on ${date}`;
                    if (time) summary += ` at ${time}`;
                    if (location) summary += ` at ${location}`;
                    
                    return summary;
                }).join('\n');
                
                return {
                    answer: `I found ${relevantEvents.length} event${relevantEvents.length !== 1 ? 's' : ''} related to your search! 📅\n\n${eventSummary}${relevantEvents.length > 3 ? `\n\n...and ${relevantEvents.length - 3} more event${relevantEvents.length - 3 !== 1 ? 's' : ''}!` : ''}`,
                    sources: relevantEvents
                };
            }
            
            // Fallback: Return events with a simple message
            return {
                answer: isFollowUp 
                    ? "I'm having a little trouble accessing that information right now. Could you try asking about the event details again?"
                    : relevantEvents.length > 0
                        ? `I found ${relevantEvents.length} event${relevantEvents.length !== 1 ? 's' : ''} related to your search! Here they are: 👇`
                        : "I couldn't find any events matching your search. Try different keywords!",
                sources: isFollowUp ? [] : relevantEvents
            };
        } catch (chatError) {
            console.warn("[AI Service Warning] Chat generation failed. Returning fallback response.", chatError.message);
            
            // For follow-up questions, try to extract answer from conversation history
            if (isFollowUp) {
                console.log("[Fallback] Attempting to extract answer from conversation history for:", question);
                const extractedAnswer = extractAnswerFromHistory(question, conversationHistory);
                if (extractedAnswer) {
                    console.log("[Fallback] Successfully extracted answer from history");
                    return {
                        answer: extractedAnswer,
                        sources: []
                    };
                } else {
                    console.log("[Fallback] Could not extract answer from history, using default message");
                }
            }
            
            // Fallback: Generate a simple response from events found (when AI is down)
            if (!isFollowUp && relevantEvents.length > 0) {
                // Generate a simple text response from the events
                const eventSummary = relevantEvents.slice(0, 3).map((event, idx) => {
                    const details = event.event_details || {};
                    const name = details.event_name || 'Event';
                    const date = details.event_date && details.event_date !== 'N/A' ? details.event_date : '';
                    const location = details.location && details.location !== 'N/A' ? details.location : '';
                    const time = details.event_time && details.event_time !== 'N/A' ? details.event_time : '';
                    
                    let summary = `${idx + 1}. ${name}`;
                    if (date) summary += ` on ${date}`;
                    if (time) summary += ` at ${time}`;
                    if (location) summary += ` at ${location}`;
                    
                    return summary;
                }).join('\n');
                
                return {
                    answer: `I found ${relevantEvents.length} event${relevantEvents.length !== 1 ? 's' : ''} related to your search! 📅\n\n${eventSummary}${relevantEvents.length > 3 ? `\n\n...and ${relevantEvents.length - 3} more event${relevantEvents.length - 3 !== 1 ? 's' : ''}!` : ''}`,
                    sources: relevantEvents
                };
            }
            
            // Fallback: If LLM fails, return the raw events with a simple message
            // But don't show events for follow-up questions
            return {
                answer: isFollowUp 
                    ? "I'm having a little trouble accessing that information right now. Could you try asking about the event details again?"
                    : relevantEvents.length > 0
                        ? `I found ${relevantEvents.length} event${relevantEvents.length !== 1 ? 's' : ''} related to your search! Here they are: 👇`
                        : "I couldn't find any events matching your search. Try different keywords!",
                sources: isFollowUp ? [] : relevantEvents
            };
        }
    } catch (error) {
        console.error("[AI Service Error]:", error.message);
        // Final Safety Net: If we have relevantEvents from earlier, use them
        // Otherwise fall back to standard search
        if (typeof relevantEvents !== 'undefined' && relevantEvents.length > 0) {
            return {
                answer: `I found ${relevantEvents.length} event${relevantEvents.length !== 1 ? 's' : ''} related to your search! Here they are: 👇`,
                sources: relevantEvents
            };
        }
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
        }).limit(50).toArray();

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
