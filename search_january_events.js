const mongoose = require('mongoose');
require('dotenv').config();

async function searchJanuaryEvents() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        const eventsCollection = mongoose.connection.collection('events');

        // Search for events in January 2026
        const januaryEvents = await eventsCollection.find({
            $or: [
                { "event_details.event_date": /january/i },
                { "event_details.event_date": /jan/i },
                { "event_details.event_date": /25/i },
                { "event_details.event_date": /2026/i }
            ]
        }).toArray();

        console.log(`\nFound ${januaryEvents.length} events potentially in January:`);

        januaryEvents.forEach((event, idx) => {
            console.log(`\n--- Event ${idx + 1} ---`);
            console.log('Name:', event.event_details?.event_name || 'N/A');
            console.log('Date:', event.event_details?.event_date || 'N/A');
            console.log('Time:', event.event_details?.event_time || 'N/A');
            console.log('Location:', event.event_details?.location || 'N/A');
            console.log('Organizer:', event.event_details?.organizer || 'N/A');
        });

        // Also search in full_text
        console.log('\n\n=== Searching in full_text field ===');
        const textSearchEvents = await eventsCollection.find({
            $or: [
                { "full_text": /january.*25/i },
                { "full_text": /25.*january/i },
                { "full_text": /jan.*25/i },
                { "full_text": /25.*jan/i }
            ]
        }).toArray();

        console.log(`\nFound ${textSearchEvents.length} events with January 25 in full text:`);
        textSearchEvents.forEach((event, idx) => {
            console.log(`\n--- Event ${idx + 1} ---`);
            console.log('Name:', event.event_details?.event_name || 'N/A');
            console.log('Full Text:', event.full_text?.substring(0, 200) || 'N/A');
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

searchJanuaryEvents();
