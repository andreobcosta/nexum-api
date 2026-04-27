const path = require('path');
const fs = require('fs');

const SEED_ID = '001_instrument_library';
const DATA_PATH = path.join(__dirname, '../../data/nexum_biblioteca_clinica_neuropsi.json');

async function run(db) {
  const biblioteca = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const instrumentos = Object.keys(biblioteca);

  console.log(`[${SEED_ID}] ${instrumentos.length} instrumentos: ${instrumentos.join(', ')}`);

  for (const nome of instrumentos) {
    await db.collection('instrument_library').doc(nome).set(biblioteca[nome], { merge: true });
    console.log(`[${SEED_ID}] ${nome} — carregado`);
  }
}

module.exports = { id: SEED_ID, run };
