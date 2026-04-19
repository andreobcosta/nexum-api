// migrate-transcribe.js
// Transcreve todos os áudios existentes sem transcrição
// Rodar: node migrate-transcribe.js

const path = require('path');
const fs = require('fs');

// Carrega variáveis de ambiente se existir .env
if (fs.existsSync(path.join(__dirname, 'backend', '.env'))) {
  require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
}

const { getDb } = require('./backend/db/firestore');
const drive = require('./backend/services/drive');
const { transcribeAudio } = require('./backend/services/transcription');
const { v4: uuidv4 } = require('uuid');

async function migrarTranscricoes() {
  console.log('\n═══════════════════════════════════════');
  console.log('  NEXUM — Migração de Transcrições');
  console.log('═══════════════════════════════════════\n');

  const db = getDb();

  // Busca todos os pacientes
  const patientsSnap = await db.collection('patients').get();
  console.log(`Pacientes encontrados: ${patientsSnap.size}\n`);

  let totalAudios = 0;
  let transcritos = 0;
  let falhas = 0;

  for (const patientDoc of patientsSnap.docs) {
    const patient = { id: patientDoc.id, ...patientDoc.data() };

    // Busca arquivos de áudio sem transcrição
    const filesSnap = await db.collection('patients').doc(patient.id)
      .collection('files')
      .where('file_type', '==', 'audio')
      .get();

    const pendentes = filesSnap.docs.filter(d => {
      const data = d.data();
      return !data.transcription && data.status !== 'transcribing';
    });

    if (pendentes.length === 0) continue;

    console.log(`\n── ${patient.full_name} (${pendentes.length} áudio(s) pendente(s))`);
    totalAudios += pendentes.length;

    for (const fileDoc of pendentes) {
      const file = { id: fileDoc.id, ...fileDoc.data() };
      const fileRef = db.collection('patients').doc(patient.id).collection('files').doc(file.id);

      console.log(`   Transcrevendo: ${file.original_name}...`);

      let tempPath = null;
      try {
        // Marca como transcrevendo
        await fileRef.update({ status: 'transcribing' });

        // Baixa do Drive
        const buffer = await drive.downloadFile(file.drive_file_id);
        tempPath = path.join(__dirname, 'backend', 'temp', 'migrate_' + uuidv4());

        // Garante que a pasta temp existe
        const tempDir = path.join(__dirname, 'backend', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        fs.writeFileSync(tempPath, buffer);

        // Detecta mimeType
        const metadata = file.metadata ? JSON.parse(file.metadata) : {};
        const mimeType = metadata.mimeType || 'audio/webm';

        // Transcreve
        const transcription = await transcribeAudio(tempPath, mimeType, file.original_name);
        const now = new Date().toISOString();

        // Salva transcrição
        await fileRef.update({
          transcription,
          status: 'transcribed',
          transcribed_at: now
        });

        // Salva .txt no Drive
        try {
          const txtName = file.original_name.replace(/\.[^.]+$/, '') + '_transcricao.txt';
          const txtContent = 'TRANSCRICAO — ' + file.original_name + '\nGerada em: ' + now + '\n\n' + transcription;
          const txtBuffer = Buffer.from(txtContent, 'utf-8');
          await drive.uploadBuffer(txtBuffer, txtName, 'text/plain', file.drive_folder_id);
          console.log(`   ✓ Transcrito e salvo no Drive: ${txtName}`);
        } catch (driveErr) {
          console.warn(`   ⚠ Transcrito mas não salvou .txt no Drive: ${driveErr.message}`);
        }

        // Log de atividade
        await db.collection('activity_log').add({
          patient_id: patient.id,
          action: 'file_transcribed',
          details: JSON.stringify({ file_id: file.id, name: file.original_name, migration: true }),
          created_at: new Date().toISOString()
        });

        transcritos++;
        console.log(`   ✓ Concluído (${transcription.length} chars)`);

      } catch (err) {
        falhas++;
        console.error(`   ✗ Erro: ${err.message}`);
        try { await fileRef.update({ status: 'transcription_failed' }); } catch (_) {}
      } finally {
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }

      // Pausa entre transcrições para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  CONCLUÍDO`);
  console.log(`  Total de áudios: ${totalAudios}`);
  console.log(`  Transcritos: ${transcritos}`);
  console.log(`  Falhas: ${falhas}`);
  console.log('═══════════════════════════════════════\n');
}

migrarTranscricoes().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
