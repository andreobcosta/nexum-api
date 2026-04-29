'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { getDb } = require('../db/firestore');

async function main() {
  const db = getDb();

  const conteudo = fs.readFileSync(
    path.join(__dirname, '../prompts/system_prompt_ran.md'),
    'utf-8'
  );

  const agora = new Date().toISOString();
  const activeRef = db.collection('system_prompts').doc('active');
  const activeDoc = await activeRef.get();

  if (activeDoc.exists) {
    console.log('[Seed] Doc active existe — arquivando em system_prompts_history...');
    await db.collection('system_prompts_history').add({
      ...activeDoc.data(),
      archived_at: agora
    });
    console.log('[Seed] Versão anterior arquivada.');
  } else {
    console.log('[Seed] Nenhum doc active encontrado — criando do zero.');
  }

  await activeRef.set({
    conteudo,
    versao: agora,
    updated_at: agora,
    admin: 'seed'
  });
  console.log('[Seed] system_prompts/active salvo com sucesso.');

  await db.collection('activity_log').add({
    action: 'seed_system_prompt',
    admin: 'seed',
    details: 'seed inicial via script',
    created_at: agora
  });
  console.log('[Seed] activity_log registrado.');

  console.log('[Seed] Concluído.');
  process.exit(0);
}

main().catch(err => {
  console.error('[Seed] Erro:', err);
  process.exit(1);
});
