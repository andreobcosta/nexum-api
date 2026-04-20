import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, FileText, Loader2, ChevronRight, ChevronDown, Trash2, Clock, CheckCircle } from 'lucide-react';
import { api } from '../utils/api';

const FOLDERS = [
  { key: 'anamnese', label: '01 - Anamnese', required: true },
  { key: 'teste', label: '02 - Testes aplicados', required: true },
  { key: 'sessao', label: '03 - Sessões', required: true },
  { key: 'relatorio', label: '04 - Relatórios', required: false },
  { key: 'intervencao', label: '05 - Intervenções', required: false },
  { key: 'externo', label: '06 - Documentos externos', required: false },
];

const PROGRESS_STEPS = [
  { key: 'preprocessor', label: 'Pré-processando arquivos' },
  { key: 'analitico', label: 'Agente Analítico' },
  { key: 'redator', label: 'Agente Redator' },
  { key: 'revisor', label: 'Agente Revisor' },
];

export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingUpdate, setGeneratingUpdate] = useState(false);
  const [progressStep, setProgressStep] = useState(-1);
  const [progressMsg, setProgressMsg] = useState('');
  const [toast, setToast] = useState(null);
  const [openFolder, setOpenFolder] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const [showConfirmRAN, setShowConfirmRAN] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  // Poll para atualizar status de transcrição em andamento
  const hasPendingTranscription = patient?.files &&
    Object.values(patient.files).flat().some(f => f.status === 'transcribing' || f.status === 'pending_transcription');

  useEffect(() => {
    loadPatient();
  }, [id]);

  useEffect(() => {
    if (!hasPendingTranscription) return;
    const interval = setInterval(loadPatient, 8000);
    return () => clearInterval(interval);
  }, [hasPendingTranscription]);

  async function loadPatient() {
    try {
      const data = await api.getPatient(id);
      setPatient(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function advanceProgress(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes('pré-process') || lower.includes('pre-process')) setProgressStep(0);
    else if (lower.includes('analítico') || lower.includes('analitico')) setProgressStep(1);
    else if (lower.includes('redator')) setProgressStep(2);
    else if (lower.includes('revisor')) setProgressStep(3);
    setProgressMsg(msg);
  }

  async function handleGenerate() {
    if (!showConfirmRAN) {
      setShowConfirmRAN(true);
      return;
    }
    setShowConfirmRAN(false);
    if (!patient.ready_for_ran) {
      const ok = confirm('Dados incompletos. Deseja gerar mesmo assim?');
      if (!ok) return;
    }
    setGenerating(true);
    setProgressStep(0);
    setProgressMsg('Iniciando pipeline...');
    try {
      const result = await api.generateReport(id, true);
      showToast(`Relatório v${result.version} gerado!`);
      navigate(`/relatorio/${id}/${result.id}`);
    } catch (err) {
      if (err.message === 'Qualidade insuficiente' || err.message?.includes('Score')) {
        try {
          const result = await api.generateReport(id, true, true);
          showToast('Rascunho gerado com dados parciais.');
          navigate(`/relatorio/${id}/${result.id}`);
          return;
        } catch (err2) {}
      }
      showToast('Erro: ' + (err.message || 'Tente novamente'));
    } finally {
      setGenerating(false);
      setProgressStep(-1);
    }
  }

  async function handleUpdate(reportId) {
    setGeneratingUpdate(true);
    setProgressStep(0);
    setProgressMsg('Analisando novos documentos...');
    try {
      const result = await api.updateReport(id, reportId);
      showToast(`RAN atualizado — v${result.version}`);
      navigate(`/relatorio/${id}/${result.id}`);
    } catch (err) {
      showToast('Erro ao atualizar: ' + err.message);
    } finally {
      setGeneratingUpdate(false);
      setProgressStep(-1);
    }
  }

  async function handleDeleteFile(fileId, fileName) {
    if (deletingFile !== fileId) {
      setDeletingFile(fileId);
      return;
    }
    try {
      await api.deleteFile(id, fileId);
      showToast(`${fileName} removido`);
      setDeletingFile(null);
      loadPatient();
    } catch (err) {
      showToast('Erro ao remover: ' + err.message);
      setDeletingFile(null);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function getFilesForFolder(key) {
    if (!patient?.files) return [];
    return patient.files[key] || [];
  }

  function getCount(key) {
    if (!patient?.completeness) return 0;
    if (key === 'relatorio') return patient.completeness.reports || 0;
    if (key === 'intervencao') return 0;
    return patient.completeness[key] || 0;
  }

  function getScoreColor(score) {
    if (score >= 60) return { bg: '#e8f5e9', color: '#2e7d32' };
    if (score >= 40) return { bg: '#fff8e1', color: '#f57f17' };
    return { bg: '#ffebee', color: '#c62828' };
  }

  function renderFileStatus(file) {
    if (file.status === 'transcribing' || file.status === 'pending_transcription') {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--amber)' }}>
          <Clock style={{ width: 11, height: 11 }} /> Transcrevendo...
        </span>
      );
    }
    if (file.transcription) {
      return <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Transcrito</span>;
    }
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{file.file_type || 'arquivo'}</span>;
  }

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  if (!patient) {
    return <div className="empty-state"><p>Paciente não encontrado.</p></div>;
  }

  const latestReport = patient.reports?.[0];

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <button onClick={() => navigate('/')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 16, fontWeight: 500 }}>
        <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
      </button>

      {/* Card do paciente */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: patient.medications ? 12 : 0 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, background: 'var(--bg-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-inverse)', fontWeight: 600, fontSize: 20, fontFamily: 'var(--font-display)'
          }}>
            {patient.full_name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 2 }}>{patient.full_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {[patient.age && `${patient.age} anos`, patient.grade].filter(Boolean).join(' · ')}
            </div>
          </div>
          {!patient.ready_for_ran && (
            <span className="badge badge-warning" style={{ fontSize: 10 }}>Faltam dados</span>
          )}
        </div>
        {patient.medications && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8 }}>
            💊 {patient.medications}
          </div>
        )}
      </div>

      {/* Pastas */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Documentos</h3>
        <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}
          onClick={() => navigate(`/paciente/${id}/enviar`)}>
          <Plus style={{ width: 16, height: 16 }} /> Enviar
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        {FOLDERS.map(({ key, label, required }) => {
          const count = getCount(key);
          const hasFils = count > 0;
          const isOpen = openFolder === key;
          const files = getFilesForFolder(key);
          const hasTranscribing = files.some(f => f.status === 'transcribing' || f.status === 'pending_transcription');

          return (
            <div key={key}>
              <button
                onClick={() => hasFils ? setOpenFolder(isOpen ? null : key) : navigate(`/paciente/${id}/enviar`)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, marginBottom: 6 }}>
                <div className={`folder-row ${hasFils ? 'has-files' : 'empty'}`} style={{ cursor: hasFils ? 'pointer' : 'default' }}>
                  <div className={`folder-dot ${hasFils ? 'active' : 'inactive'}`} />
                  <span className="folder-name">
                    {label}
                    {required && !hasFils && <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 6 }}>necessário</span>}
                    {hasTranscribing && <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 6 }}>⟳ transcrevendo</span>}
                  </span>
                  <span className="folder-count" style={{ marginRight: 4 }}>{count > 0 ? count : ''}</span>
                  {hasFils && (isOpen
                    ? <ChevronDown style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
                    : <ChevronRight style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
                  )}
                </div>
              </button>

              {isOpen && files.length > 0 && (
                <div style={{ marginLeft: 12, marginBottom: 8, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                  {files.map(file => (
                    <div key={file.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 0', borderBottom: '1px solid var(--border-light)'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.original_name}
                        </div>
                        <div style={{ marginTop: 2 }}>{renderFileStatus(file)}</div>
                      </div>
                      <button
                        onClick={() => handleDeleteFile(file.id, file.original_name)}
                        style={{
                          background: deletingFile === file.id ? 'var(--red-light)' : 'none',
                          border: 'none', padding: '4px 8px', borderRadius: 6,
                          color: deletingFile === file.id ? 'var(--red)' : 'var(--text-muted)',
                          fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0
                        }}>
                        <Trash2 style={{ width: 13, height: 13 }} />
                        {deletingFile === file.id ? 'Confirmar' : ''}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Indicador de progresso */}
      {(generating || generatingUpdate) && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: 'var(--text)' }}>
            Gerando RAN — pode levar até 6 min
          </div>
          {PROGRESS_STEPS.map((step, i) => (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i < progressStep ? 'var(--green)' : i === progressStep ? 'var(--amber-light)' : 'var(--bg-surface)',
                border: i === progressStep ? '2px solid var(--amber)' : 'none'
              }}>
                {i < progressStep
                  ? <CheckCircle style={{ width: 14, height: 14, color: 'white' }} />
                  : i === progressStep
                    ? <div className="spinner" style={{ width: 12, height: 12, borderTopColor: 'var(--amber)', borderColor: 'var(--border)' }} />
                    : <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</span>
                }
              </div>
              <span style={{
                fontSize: 13,
                color: i < progressStep ? 'var(--green)' : i === progressStep ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: i === progressStep ? 500 : 400
              }}>{step.label}</span>
            </div>
          ))}
          {progressMsg && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              {progressMsg}
            </div>
          )}
        </div>
      )}

      {/* Botões de gerar/atualizar */}
      {!(generating || generatingUpdate) && (
        <>
          {showConfirmRAN && (
            <div className="card" style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--amber-light)', border: '1px solid var(--amber)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)', marginBottom: 4 }}>Confirmar geração de RAN</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Custo estimado: ~$0.28 USD · Tempo: ~5 minutos
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ flex: 1, height: 40, fontSize: 13 }}
                  onClick={() => setShowConfirmRAN(false)}>Cancelar</button>
                <button className="btn btn-primary" style={{ flex: 2, height: 40, fontSize: 13 }}
                  onClick={handleGenerate}>Confirmar</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <button className="btn btn-primary" style={{ flex: latestReport ? 1 : 2, height: 52, fontSize: 15, gap: 8 }}
              onClick={handleGenerate}>
              <FileText style={{ width: 18, height: 18 }} />
              {latestReport ? 'Novo RAN' : 'Gerar RAN'}
            </button>
            {latestReport && (
              <button className="btn btn-outline" style={{ flex: 1, height: 52, fontSize: 14, gap: 6 }}
                onClick={() => handleUpdate(latestReport.id)}>
                <Loader2 style={{ width: 16, height: 16 }} />
                Atualizar
              </button>
            )}
          </div>

          {!patient.ready_for_ran && (
            <p style={{ fontSize: 12, color: 'var(--amber)', textAlign: 'center', marginTop: 4 }}>
              ⚠ Anamnese, testes ou sessões pendentes — o relatório terá lacunas
            </p>
          )}
        </>
      )}

      {/* Lista de relatórios */}
      {patient.reports?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Relatórios gerados</h3>
          {patient.reports.map((r) => {
            let score = null;
            try {
              const meta = typeof r.ran_meta === 'string' ? JSON.parse(r.ran_meta) : r.ran_meta;
              score = meta?.revisao?.score_qualidade;
            } catch (e) {}
            const sc = score !== null ? getScoreColor(score) : null;

            return (
              <button key={r.id} className="card" style={{ width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer' }}
                onClick={() => navigate(`/relatorio/${id}/${r.id}`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileText style={{ width: 18, height: 18, color: 'var(--green)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>RAN v{r.version}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {new Date(r.generated_at).toLocaleDateString('pt-BR')} · {r.status === 'draft' ? 'Rascunho' : 'Revisado'}
                    </div>
                  </div>
                  {sc && score !== null && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color, flexShrink: 0 }}>
                      {score}/100
                    </span>
                  )}
                  <ChevronRight style={{ width: 16, height: 16, color: 'var(--text-muted)', flexShrink: 0 }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
