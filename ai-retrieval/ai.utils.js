/**
 * Utility functions for the AI Retrieval service
 */

/**
 * Standardize common responses or formatting
 */
const responseFormatter = (answer, sources = []) => {
    return {
        answer,
        sources // Return full source objects so frontend can access all details (event_details, time, etc.)
    };
};

module.exports = {
    responseFormatter
};
