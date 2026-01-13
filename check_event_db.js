const mongoose = require('mongoose');
require('dotenv').config();

async function checkEventDatabase() {
  try {
    // Connect directly to the cluster without specifying database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas cluster');
    
    // Get the event_database specifically
    const eventDB = mongoose.connection.client.db('event_database');
    console.log('Accessing event_database');
    
    // List all collections in event_database
    const collections = await eventDB.listCollections().toArray();
    console.log('\nCollections in event_database:');
    collections.forEach(col => {
      console.log(`- ${col.name}`);
    });
    
    // Check each collection
    for (const col of collections) {
      const collection = eventDB.collection(col.name);
      const count = await collection.countDocuments();
      console.log(`\n${col.name} collection: ${count} documents`);
      
      if (count > 0) {
        // Get first document
        const sample = await collection.findOne();
        console.log('Sample document structure:');
        console.log(JSON.stringify(sample, null, 2));
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkEventDatabase();
