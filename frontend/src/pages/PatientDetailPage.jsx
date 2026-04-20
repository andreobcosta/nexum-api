import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, FileText, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

const FOLDERS = [
  { key: 'anamnese', label: '01 - Anamnese', required: true },
  { key: 'teste', label: '02 - Testes aplicados', required: true },
  { key: 'sessao', label: '03 - Sessões', required: true },
  { key: 'relatorio', label: '04 - Relatórios', required: false },
  { key: 'intervencao', label: '05 - Intervenções', required: false },
  { key: 'externo', label: '06 - Documentos externos', required: false },
];

export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadPatient();
  }, [id]);

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

  async function handleGenerate() {
    if (!patient.ready_for_ran) {
      const ok = confirm('Dados incompletos. Deseja gerar mesmo assim?');
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const result = await api.generateReport(id, true);
      showToast(`Relatório v${result.version} gerado!`);
      navigate(`/relatorio/${result.id}`);
    } catch (err) {
      // Score baixo mas relatório foi gerado — salvar como rascunho e navegar
      if (err.message === 'Qualidade insuficiente' || err.message?.includes('Score')) {
        try {
          const result = await api.generateReport(id, true, true); // force_save=true
          showToast('Rascunho gerado com dados parciais. Revise antes de finalizar.');
          navigate(`/relatorio/${result.id}`);
          return;
        } catch (err2) {
          // Se ainda falhar, mostra erro detalhado
        }
      }
      showToast('Erro: ' + (err.message || 'Tente novamente'));
    } finally {
      setGenerating(false);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function getCount(key) {
    if (!patient?.completeness) return 0;
    if (key === 'relatorio') return patient.completeness.reports || 0;
    if (key === 'intervencao') return 0;
    return patient.completeness[key] || 0;
  }

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  if (!patient) {
    return <div className="empty-state"><p>Paciente não encontrado.</p></div>;
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <button onClick={() => navigate('/')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 16, fontWeight: 500 }}>
        <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
      </button>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, background: 'var(--bg-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-inverse)', fontWeight: 600, fontSize: 20, fontFamily: 'var(--font-display)'
          }}>
            {patient.full_name.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 2 }}>{patient.full_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {[patient.age && `${patient.age} anos`, patient.grade].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        {patient.medications && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8 }}>
            Medicamentos: {patient.medications}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Pastas do paciente</h3>
        <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}
          onClick={() => navigate(`/paciente/${id}/enviar`)}>
          <Plus style={{ width: 16, height: 16 }} /> Enviar
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        {FOLDERS.map(({ key, label, required }) => {
          const count = getCount(key);
          const hasFils = count > 0;
          return (
            <div key={key} className={`folder-row ${hasFils ? 'has-files' : 'empty'}`}>
              <div className={`folder-dot ${hasFils ? 'active' : 'inactive'}`} />
              <span className="folder-name">
                {label}
                {required && !hasFils && <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 6 }}>obrigatório</span>}
              </span>
              <span className="folder-count">{count}</span>
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary btn-block" onClick={handleGenerate} disabled={generating}
        style={{ height: 56, fontSize: 16, gap: 10 }}>
        {generating ? (
          <>
            <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} />
            Gerando... (pode levar até 5 min)
          </>
        ) : (
          <>
            <FileText style={{ width: 20, height: 20 }} />
            Gerar relatório RAN
          </>
        )}
      </button>

      {!patient.ready_for_ran && (
        <p style={{ fontSize: 12, color: 'var(--amber)', textAlign: 'center', marginTop: 10 }}>
          Dados incompletos — o relatório pode ter lacunas
        </p>
      )}

      {patient.reports?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Relatórios gerados</h3>
          {patient.reports.map((r) => (
            <button key={r.id} className="card" style={{ width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer' }}
              onClick={() => navigate(`/relatorio/${r.id}`)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText style={{ width: 18, height: 18, color: 'var(--green)' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Versão {r.version}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {new Date(r.generated_at).toLocaleDateString('pt-BR')} · {r.status === 'draft' ? 'Rascunho' : 'Revisado'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
