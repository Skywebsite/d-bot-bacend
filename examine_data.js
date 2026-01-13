const mongoose = require('mongoose');
require('dotenv').config();

async function examineEventData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI + 'event_database');
    console.log('Connected to event_database');
    const db = mongoose.connection.db;
    const eventsCollection = db.collection('events');
    
    // Get all documents to see the structure
    const events = await eventsCollection.find().toArray();
    console.log(`\nTotal events: ${events.length}`);
    
    events.forEach((event, i) => {
      console.log(`\n=== Event ${i+1} ===`);
      console.log('Keys:', Object.keys(event));
      
      if (event.event_details) {
        console.log('Event details keys:', Object.keys(event.event_details));
        console.log('Event details:', JSON.stringify(event.event_details, null, 2));
      }
      
      if (event.raw_ocr) {
        console.log('Raw OCR (first 200 chars):', event.raw_ocr.substring(0, 200) + '...');
      }
      
      if (event.full_text) {
        console.log('Full text (first 200 chars):', event.full_text.substring(0, 200) + '...');
      }
      
      console.log('---');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

examineEventData();
