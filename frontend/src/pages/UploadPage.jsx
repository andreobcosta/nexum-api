import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, Camera, FileUp, StickyNote, Send, X } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { api } from '../utils/api';

const CATEGORIES = [
  { value: 'anamnese', label: 'Anamnese', desc: 'Entrevista com família' },
  { value: 'teste', label: 'Teste aplicado', desc: 'Protocolos de avaliação' },
  { value: 'sessao', label: 'Sessão', desc: 'Registro de sessão' },
  { value: 'externo', label: 'Doc. externo', desc: 'Laudo, relatório escolar' },
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
    setTimeout(() => setToast(null), 3500);
  }

  async function uploadFile(file) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('patient_id', id);
      fd.append('category', category);
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

  // Seleção de categoria (aparece em todos os modos)
  function CategoryPicker() {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>Categoria</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCategory(c.value)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                border: '1px solid var(--border)',
                background: category === c.value ? 'var(--bg-accent)' : 'transparent',
                color: category === c.value ? 'var(--text-inverse)' : 'var(--text-secondary)',
              }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Tela principal — seleção do modo
  if (!mode) {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => navigate(`/paciente/${id}`)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 20 }}>Enviar arquivo</h2>

        <CategoryPicker />

        <div className="upload-grid">
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

  // Tela de gravação de áudio
  if (mode === 'audio') {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => { recorder.reset(); setMode(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <CategoryPicker />

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

        {uploading && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
            Enviando... A transcrição será feita em background.
          </p>
        )}
      </div>
    );
  }

  // Tela de nota de texto
  if (mode === 'note') {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <button onClick={() => setMode(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 20, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>

        <CategoryPicker />

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

  // Fallback para file/camera
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
