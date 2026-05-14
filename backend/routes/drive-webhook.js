const express = require('express');
const router = express.Router();

// POST /api/drive/webhook — stub mantido para compatibilidade de URL
// Drive foi migrado para Google Cloud Storage — webhooks não são mais utilizados
router.post('/', (req, res) => {
  res.status(200).end();
});

module.exports = router;
