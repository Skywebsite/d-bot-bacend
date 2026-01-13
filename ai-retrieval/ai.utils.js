/**
 * Utility functions for the AI Retrieval service
 */

/**
 * Standardize common responses or formatting
 */
const responseFormatter = (answer, sources = []) => {
    return {
        answer,
        sources: sources.map(s => ({
            name: s.event_details?.event_name,
            date: s.event_details?.event_date,
            location: s.event_details?.location
        }))
    };
};

module.exports = {
    responseFormatter
};
