const mongoose = require('mongoose');
require('dotenv').config();

async function getFullEventDetails() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        const eventsCollection = mongoose.connection.collection('events');

        // Get all events
        const allEvents = await eventsCollection.find({}).toArray();

        console.log(`\nTotal events in database: ${allEvents.length}\n`);

        // Display all events with their dates
        allEvents.forEach((event, idx) => {
            console.log(`\n========== Event ${idx + 1} ==========`);
            console.log('Event Name:', event.event_details?.event_name || 'N/A');
            console.log('Organizer:', event.event_details?.organizer || 'N/A');
            console.log('Date:', event.event_details?.event_date || 'N/A');
            console.log('Time:', event.event_details?.event_time || 'N/A');
            console.log('Location:', event.event_details?.location || 'N/A');
            console.log('Entry Type:', event.event_details?.entry_type || 'N/A');
            console.log('Website:', event.event_details?.website || 'N/A');
            console.log('Full Text Preview:', event.full_text?.substring(0, 150) || 'N/A');
            console.log('=====================================');
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

getFullEventDetails();
