const mongoose = require('mongoose');
const OpenAI = require('openai');
require('dotenv').config();

async function addEmbeddings() {
  try {
    // Connect to event_database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to event_database');
    
    const db = mongoose.connection.db;
    const eventsCollection = db.collection('events');
    
    // Initialize OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Get all events without embeddings
    const events = await eventsCollection.find({ embedding: { $exists: false } }).toArray();
    console.log(`Found ${events.length} events without embeddings`);
    
    if (events.length === 0) {
      console.log('All events already have embeddings!');
      return;
    }
    
    // Process events in batches
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      // Create searchable text from event details and full_text
      const searchableText = [
        event.event_details?.event_name || '',
        event.event_details?.organizer || '',
        event.event_details?.event_date || '',
        event.event_details?.event_time || '',
        event.event_details?.location || '',
        event.event_details?.entry_type || '',
        event.full_text || '',
        ...(event.raw_ocr?.map(ocr => ocr.text) || [])
      ].filter(Boolean).join(' ');
      
      console.log(`Processing event ${i + 1}/${events.length}: ${event.event_details?.event_name || 'Unknown'}`);
      
      try {
        // Generate embedding
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: searchableText,
        });
        
        const embedding = response.data[0].embedding;
        
        // Update document with embedding
        await eventsCollection.updateOne(
          { _id: event._id },
          { $set: { embedding: embedding } }
        );
        
        console.log(`✓ Added embedding to event ${event._id}`);
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`✗ Failed to process event ${event._id}:`, error.message);
      }
    }
    
    console.log('\nEmbedding generation complete!');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

addEmbeddings();
