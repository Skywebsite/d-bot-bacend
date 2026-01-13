const mongoose = require('mongoose');
require('dotenv').config();

async function checkDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;
    
    // List all collections with more details
    const collections = await db.listCollections().toArray();
    console.log('\nCollections found:', collections.length);
    
    if (collections.length === 0) {
      console.log('No collections found. Database might be empty.');
    } else {
      for (const col of collections) {
        console.log('\n=== Collection:', col.name, '===');
        const coll = db.collection(col.name);
        
        // Get count
        const count = await coll.countDocuments();
        console.log('Document count:', count);
        
        if (count > 0) {
          // Get sample documents
          const samples = await coll.find().limit(3).toArray();
          console.log('Sample documents:');
          samples.forEach((doc, i) => {
            console.log(`--- Document ${i+1} ---`);
            console.log(JSON.stringify(doc, null, 2));
            console.log('Keys:', Object.keys(doc));
          });
        }
      }
    }
    
    // Also check database name
    console.log('\nDatabase name:', db.databaseName);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkDB();
