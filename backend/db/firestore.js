const { Firestore } = require('@google-cloud/firestore');
let db;
function getDb() {
  if (!db) {
    const config = {
      projectId: process.env.GCP_PROJECT_ID,
      databaseId: process.env.FIRESTORE_DATABASE_ID || 'nexum-db'
    };
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      config.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    }
    db = new Firestore(config);
  }
  return db;
}
module.exports = { getDb };
