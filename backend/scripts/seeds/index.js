const path = require('path');
const fs = require('fs');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
}

const { getDb } = require('../../db/firestore');

async function main() {
  const db = getDb();
  const seedsDir = __dirname;

  const files = fs.readdirSync(seedsDir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort();

  console.log(`[seeds] ${files.length} seed(s) encontrado(s)`);

  for (const file of files) {
    const seedId = path.basename(file, '.js');
    const logRef = db.collection('seed_log').doc(seedId);
    const logDoc = await logRef.get();

    if (logDoc.exists && logDoc.data().status === 'ok') {
      console.log(`[seeds] ${seedId} — já aplicado, pulando`);
      continue;
    }

    console.log(`[seeds] Executando ${seedId}...`);

    try {
      const seed = require(path.join(seedsDir, file));
      await seed.run(db);

      await logRef.set({
        seed_id: seedId,
        executado_em: new Date().toISOString(),
        status: 'ok'
      });

      console.log(`[seeds] ${seedId} — concluído`);
    } catch (err) {
      console.error(`[seeds] ERRO em ${seedId}:`, err.message);

      await logRef.set({
        seed_id: seedId,
        executado_em: new Date().toISOString(),
        status: 'erro',
        erro: err.message
      }).catch(() => {});

      process.exit(1);
    }
  }

  console.log('[seeds] Todos os seeds aplicados com sucesso.');
  process.exit(0);
}

main().catch(err => {
  console.error('[seeds] Erro fatal:', err);
  process.exit(1);
});
