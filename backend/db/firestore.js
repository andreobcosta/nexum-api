const { Firestore } = require('@google-cloud/firestore');
let db;
function getDb() {
  if (!db) {
    db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID,
      databaseId: process.env.FIRESTORE_DATABASE_ID || 'nexum-db'
    });
  }
  return db;
}
module.exports = { getDb };
