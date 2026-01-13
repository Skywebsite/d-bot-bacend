const mongoose = require('mongoose');
require('dotenv').config();

async function findDuplicateEvents() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        const eventsCollection = mongoose.connection.collection('events');

        // Find all events
        const allEvents = await eventsCollection.find({}).toArray();

        console.log(`\nTotal events: ${allEvents.length}\n`);

        // Group by event name
        const eventsByName = {};
        allEvents.forEach(event => {
            const name = event.event_details?.event_name || 'UNNAMED';
            if (!eventsByName[name]) {
                eventsByName[name] = [];
            }
            eventsByName[name].push(event);
        });

        // Find duplicates
        console.log('=== DUPLICATE EVENTS ===\n');
        let duplicateCount = 0;

        Object.keys(eventsByName).forEach(name => {
            if (eventsByName[name].length > 1) {
                duplicateCount++;
                console.log(`\n"${name}" - ${eventsByName[name].length} copies`);
                eventsByName[name].forEach((event, idx) => {
                    console.log(`  Copy ${idx + 1}:`);
                    console.log(`    ID: ${event._id}`);
                    console.log(`    Date: ${event.event_details?.event_date || 'N/A'}`);
                    console.log(`    Location: ${event.event_details?.location || 'N/A'}`);
                    console.log(`    Quality Score: ${calculateQuality(event)}`);
                });
            }
        });

        console.log(`\n\nTotal duplicate event names: ${duplicateCount}`);

        // Show low quality events
        console.log('\n\n=== LOW QUALITY EVENTS (Score < 50) ===\n');
        const lowQuality = allEvents.filter(e => calculateQuality(e) < 50);
        console.log(`Found ${lowQuality.length} low quality events:\n`);

        lowQuality.forEach((event, idx) => {
            console.log(`${idx + 1}. "${event.event_details?.event_name || 'UNNAMED'}" (Score: ${calculateQuality(event)})`);
            console.log(`   Date: ${event.event_details?.event_date || 'N/A'}`);
            console.log(`   Location: ${event.event_details?.location || 'N/A'}`);
            console.log(`   ID: ${event._id}\n`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

function calculateQuality(event) {
    const details = event.event_details || {};
    let score = 0;

    if (details.event_name && details.event_name !== 'N/A' && details.event_name.trim().length > 0) score += 30;
    if (details.event_date && details.event_date !== 'N/A' && details.event_date.trim().length > 0) score += 25;
    if (details.location && details.location !== 'N/A' && details.location.trim().length > 0) score += 20;
    if (details.event_time && details.event_time !== 'N/A' && details.event_time.trim().length > 0) score += 10;
    if (details.organizer && details.organizer !== 'N/A' && details.organizer.trim().length > 0) score += 10;
    if (details.website && details.website !== 'N/A' && details.website.trim().length > 0) score += 5;

    return score;
}

findDuplicateEvents();
