const { Firestore } = require('@google-cloud/firestore');
let db;
function getDb() {
  if (!db) {
    db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });
  }
  return db;
}
module.exports = { getDb };
