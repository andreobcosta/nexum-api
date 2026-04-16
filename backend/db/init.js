const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'ran-clinic.db');

function initDatabase() {
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Pacientes
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      birth_date TEXT,
      age INTEGER,
      grade TEXT,
      handedness TEXT DEFAULT 'Não informado',
      medications TEXT,
      guardians TEXT,
      drive_folder_id TEXT,
      status TEXT DEFAULT 'em_avaliacao',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Arquivos enviados
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      category TEXT NOT NULL,
      drive_file_id TEXT,
      drive_folder_id TEXT,
      transcription TEXT,
      metadata TEXT,
      status TEXT DEFAULT 'uploaded',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    -- Relatórios gerados
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      drive_file_id TEXT,
      content_md TEXT,
      status TEXT DEFAULT 'draft',
      generated_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    -- Log de atividades (auditoria)
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Índices para performance
    CREATE INDEX IF NOT EXISTS idx_files_patient ON files(patient_id);
    CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
    CREATE INDEX IF NOT EXISTS idx_reports_patient ON reports(patient_id);
    CREATE INDEX IF NOT EXISTS idx_activity_patient ON activity_log(patient_id);
  `);

  console.log('Database initialized at:', DB_PATH);
  db.close();
}

initDatabase();
