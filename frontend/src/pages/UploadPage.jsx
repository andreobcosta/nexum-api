import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, Camera, FileUp, StickyNote, Send, X } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { api } from '../utils/api';

const CATEGORIES = [
  { value: 'anamnese', label: 'Anamnese' },
  { value: 'teste', label: 'Teste aplicado' },
  { value: 'sessao', label: 'Sessão' },
  { value: 'externo', label: 'Documento externo' },
];

export default function UploadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [category, setCategory] = useState('anamnese');
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const recorder = useAudioRecorder();

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function uploadFile(file, cat) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('patient_id', id);
      fd.append('category', cat || category);
      const result = await api.uploadFile(fd);
      showToast(result.message);
      setTimeout(() => navigate(`/paciente/${id}`), 1500);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSendAudio() {
    if (!recorder.audioBlob) return;
    const file = new File([recorder.audioBlob], `gravacao_${Date.now()}.webm`, { type: 'audio/webm' });
    await uploadFile(file);
  }

  async function handleSendNote() {
    if (!noteText.trim()) return;
    setUploading(true);
    try {
      const result = await api.saveNote({ patient_id: id, category, title: noteTitle || 'Nota clínica', content: noteText });
      showToast(result.message);
      setTimeout(() => navigate(`/paciente/${id}`), 1500);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  // Mode selection screen
  if (!mode) {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => navigate(`/paciente/${id}`)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Enviar arquivo</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Escolha o tipo de conteúdo para enviar
        </p>

        <div className="input-group">
          <label>Categoria</label>
          <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="upload-grid" style={{ marginTop: 8 }}>
          <button className="upload-option" onClick={() => setMode('audio')}>
            <Mic />
            <span className="label">Gravar áudio</span>
            <span className="desc">Anamnese ou sessão</span>
          </button>
          <button className="upload-option" onClick={() => { setMode('camera'); setTimeout(() => cameraInput.current?.click(), 100); }}>
            <Camera />
            <span className="label">Tirar foto</span>
            <span className="desc">Protocolo de teste</span>
          </button>
          <button className="upload-option" onClick={() => { setMode('file'); setTimeout(() => fileInput.current?.click(), 100); }}>
            <FileUp />
            <span className="label">Enviar PDF</span>
            <span className="desc">Laudo externo</span>
          </button>
          <button className="upload-option" onClick={() => setMode('note')}>
            <StickyNote />
            <span className="label">Nota de texto</span>
            <span className="desc">Observação clínica</span>
          </button>
        </div>

        <input ref={fileInput} type="file" accept=".pdf,.doc,.docx" hidden onChange={handleFileChange} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
      </div>
    );
  }

  // Audio recording screen
  if (mode === 'audio') {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => { recorder.reset(); setMode(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span className="badge badge-info">{CATEGORIES.find(c => c.value === category)?.label}</span>
        </div>

        <div className={`recorder ${recorder.isRecording ? 'recording' : ''}`}>
          <button className={`rec-button ${recorder.isRecording ? 'recording' : ''}`}
            onClick={recorder.isRecording ? recorder.stop : recorder.start}>
            <div className="rec-inner" />
          </button>
          <div className="rec-time">{recorder.formatDuration()}</div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            {recorder.isRecording ? 'Gravando... toque para parar' :
             recorder.audioBlob ? 'Gravação concluída' : 'Toque para gravar'}
          </p>
        </div>

        {recorder.audioBlob && !recorder.isRecording && (
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => recorder.reset()}>
              <X style={{ width: 16, height: 16 }} /> Descartar
            </button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSendAudio} disabled={uploading}>
              {uploading ? <div className="spinner" style={{ borderTopColor: 'white' }} /> :
                <><Send style={{ width: 16, height: 16 }} /> Enviar e transcrever</>}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Note writing screen
  if (mode === 'note') {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => setMode(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span className="badge badge-info">{CATEGORIES.find(c => c.value === category)?.label}</span>
        </div>

        <div className="input-group">
          <label>Título da nota</label>
          <input className="input-field" placeholder="Ex: Observação sessão 3" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
        </div>

        <div className="input-group">
          <label>Conteúdo *</label>
          <textarea className="input-field" rows={8} placeholder="Digite suas observações clínicas..."
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            style={{ resize: 'vertical', lineHeight: 1.6 }} />
        </div>

        <button className="btn btn-primary btn-block" onClick={handleSendNote} disabled={uploading || !noteText.trim()}
          style={{ height: 52, marginTop: 8 }}>
          {uploading ? <div className="spinner" style={{ borderTopColor: 'white' }} /> :
            <><Send style={{ width: 16, height: 16 }} /> Salvar nota</>}
        </button>
      </div>
    );
  }

  // Fallback for file/camera modes (handled by hidden input onChange)
  return (
    <div className="empty-state">
      {uploading ? (
        <>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p style={{ marginTop: 16 }}>Enviando arquivo...</p>
        </>
      ) : (
        <>
          <p>Selecione um arquivo</p>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => setMode(null)}>Voltar</button>
        </>
      )}
      <input ref={fileInput} type="file" accept=".pdf,.doc,.docx" hidden onChange={handleFileChange} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
    </div>
  );
}
