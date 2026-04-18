/**
 * migrate.js — Migração SQLite → Firestore
 * Executar UMA VEZ na VPS antes de desligar
 * node migrate.js
 */

require('dotenv').config({ path: './backend/.env' });
const Database = require('better-sqlite3');
const { Firestore } = require('@google-cloud/firestore');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'data', 'ran-clinic.db');
const PROJECT_ID = process.env.GCP_PROJECT_ID;

async function migrate() {
  console.log('🔄 Iniciando migração SQLite → Firestore...');
  console.log(`   Banco: ${DB_PATH}`);
  console.log(`   Projeto GCP: ${PROJECT_ID}\n`);

  const sqlite = new Database(DB_PATH, { readonly: true });
  const firestore = new Firestore({ projectId: PROJECT_ID });

  // 1. Pacientes
  const patients = sqlite.prepare('SELECT * FROM patients').all();
  console.log(`📋 Migrando ${patients.length} pacientes...`);
  let ok = 0;
  for (const p of patients) {
    await firestore.collection('patients').doc(p.id).set({
      full_name: p.full_name,
      birth_date: p.birth_date || null,
      age: p.age || null,
      grade: p.grade || null,
      handedness: p.handedness || 'Não informado',
      medications: p.medications || null,
      guardians: p.guardians || null,
      drive_folder_id: p.drive_folder_id || null,
      status: p.status || 'em_avaliacao',
      created_at: p.created_at,
      updated_at: p.updated_at
    });
    ok++;
    process.stdout.write(`\r   ${ok}/${patients.length} pacientes`);
  }
  console.log('\n   ✅ Pacientes migrados\n');

  // 2. Arquivos (subcoleção de cada paciente)
  const files = sqlite.prepare('SELECT * FROM files').all();
  console.log(`📁 Migrando ${files.length} arquivos...`);
  ok = 0;
  for (const f of files) {
    await firestore.collection('patients').doc(f.patient_id)
      .collection('files').doc(f.id).set({
        patient_id: f.patient_id,
        original_name: f.original_name,
        file_type: f.file_type,
        category: f.category,
        drive_file_id: f.drive_file_id || null,
        drive_folder_id: f.drive_folder_id || null,
        transcription: f.transcription || null,
        metadata: f.metadata || null,
        status: f.status || 'uploaded',
        created_at: f.created_at
      });
    ok++;
    process.stdout.write(`\r   ${ok}/${files.length} arquivos`);
  }
  console.log('\n   ✅ Arquivos migrados\n');

  // 3. Relatórios (subcoleção de cada paciente)
  const reports = sqlite.prepare('SELECT * FROM reports').all();
  console.log(`📄 Migrando ${reports.length} relatórios...`);
  ok = 0;
  for (const r of reports) {
    await firestore.collection('patients').doc(r.patient_id)
      .collection('reports').doc(r.id).set({
        patient_id: r.patient_id,
        version: r.version || 1,
        drive_file_id: r.drive_file_id || null,
        content_md: r.content_md || null,
        status: r.status || 'draft',
        generated_at: r.generated_at,
        reviewed_at: r.reviewed_at || null
      });
    ok++;
    process.stdout.write(`\r   ${ok}/${reports.length} relatórios`);
  }
  console.log('\n   ✅ Relatórios migrados\n');

  // 4. Activity log
  const logs = sqlite.prepare('SELECT * FROM activity_log').all();
  console.log(`📝 Migrando ${logs.length} logs...`);
  ok = 0;
  for (const l of logs) {
    await firestore.collection('activity_log').add({
      patient_id: l.patient_id || null,
      action: l.action,
      details: l.details || null,
      created_at: l.created_at
    });
    ok++;
    process.stdout.write(`\r   ${ok}/${logs.length} logs`);
  }
  console.log('\n   ✅ Logs migrados\n');

  sqlite.close();
  console.log('🎉 Migração concluída com sucesso!');
  console.log(`   ${patients.length} pacientes | ${files.length} arquivos | ${reports.length} relatórios`);
}

migrate().catch(err => {
  console.error('\n❌ Erro na migração:', err.message);
  process.exit(1);
});
