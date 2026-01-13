const mongoose = require('mongoose');
require('dotenv').config();

async function checkAllDBs() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');
    const admin = mongoose.connection.db.admin();
    
    // List all databases
    const result = await admin.listDatabases();
    console.log('\nAll databases in cluster:');
    result.databases.forEach(db => {
      console.log(`- ${db.name} (size: ${db.sizeOnDisk} bytes)`);
    });
    
    // Check each database for collections
    for (const dbInfo of result.databases) {
      if (dbInfo.name !== 'admin' && dbInfo.name !== 'config' && dbInfo.name !== 'local') {
        console.log(`\n=== Checking database: ${dbInfo.name} ===`);
        const db = mongoose.connection.client.db(dbInfo.name);
        const collections = await db.listCollections().toArray();
        
        if (collections.length > 0) {
          console.log(`Collections in ${dbInfo.name}:`);
          for (const col of collections) {
            const coll = db.collection(col.name);
            const count = await coll.countDocuments();
            console.log(`  - ${col.name}: ${count} documents`);
            
            if (count > 0) {
              const sample = await coll.findOne();
              console.log(`    Sample keys: ${Object.keys(sample)}`);
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkAllDBs();
