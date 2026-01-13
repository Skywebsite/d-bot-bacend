const aiService = require('./ai.service');
const { responseFormatter } = require('./ai.utils');

/**
 * Handle AI Chat Route
 */
const handleChat = async (req, res) => {
    const { question } = req.body;

    // 1. Validate Input
    if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: "Please provide a valid question string." });
    }

    try {
        // 2. Call Retrieval Logic
        const result = await aiService.getChatResponse(question);

        // 3. Return Formatted Response
        const formattedResponse = responseFormatter(result.answer, result.sources);
        res.json(formattedResponse);
    } catch (error) {
        console.error("Chat Controller Error:", error);
        res.status(500).json({
            error: "An error occurred while processing your request.",
            details: error.message
        });
    }
};

/**
 * Handle Standard Search Route (No AI)
 */
const handleStandardSearch = async (req, res) => {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Please provide a valid query string." });
    }

    try {
        const result = await aiService.performStandardSearch(query);
        // 3. Return Formatted Response (reusing same formatter)
        const formattedResponse = responseFormatter(result.answer, result.sources);
        res.json(formattedResponse);
    } catch (error) {
        console.error("Search Controller Error:", error);
        res.status(500).json({
            error: "An error occurred during search.",
            details: error.message
        });
    }
};

module.exports = {
    handleChat,
    handleStandardSearch
};
