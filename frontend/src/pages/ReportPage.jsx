import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Pencil, Save, X, ExternalLink } from 'lucide-react';
import { api } from '../utils/api';

// As 12 seções obrigatórias do RAN
const SECOES_RAN = [
  'QUEIXA PRINCIPAL',
  'ANAMNESE',
  'RESUMO DO RELATÓRIO ESCOLAR',
  'VISITA NEUROPSICOPEDAGÓGICA ESCOLAR',
  'AVALIAÇÃO NEUROPSICOPEDAGÓGICA',
  'ANÁLISE DOS INSTRUMENTOS',
  'CONCLUSÃO INTEGRADA DOS TESTES',
  'QUADRO SÍNTESE',
  'ORIENTAÇÕES À FAMÍLIA E À ESCOLA',
  'ENCAMINHAMENTOS PROFISSIONAIS',
  'CONSIDERAÇÕES FINAIS',
];

export default function ReportPage() {
  const { patientId, reportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [secaoAtiva, setSecaoAtiva] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    api.getReport(patientId, reportId)
      .then(r => { setReport(r); setEditContent(r.content_md || ''); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [patientId, reportId]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.editReport(patientId, reportId, editContent);
      setReport({ ...report, content_md: editContent, status: 'reviewed' });
      setEditing(false);
      showToast('Relatório salvo com sucesso!');
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setEditContent(report.content_md || '');
    setEditing(false);
    setSecaoAtiva(null);
  }

  // Extrai uma seção específica do Markdown
  function getSecao(titulo) {
    if (!editContent) return '';
    const linhas = editContent.split('\n');
    const inicio = linhas.findIndex(l =>
      l.replace(/#+\s*/, '').toUpperCase().includes(titulo.toUpperCase())
    );
    if (inicio === -1) return '';
    let fim = linhas.length;
    for (let i = inicio + 1; i < linhas.length; i++) {
      if (linhas[i].startsWith('## ') || linhas[i].startsWith('---')) {
        fim = i;
        break;
      }
    }
    return linhas.slice(inicio, fim).join('\n');
  }

  // Substitui uma seção no conteúdo completo
  function setSecao(titulo, novoConteudo) {
    const linhas = editContent.split('\n');
    const inicio = linhas.findIndex(l =>
      l.replace(/#+\s*/, '').toUpperCase().includes(titulo.toUpperCase())
    );
    if (inicio === -1) return;
    let fim = linhas.length;
    for (let i = inicio + 1; i < linhas.length; i++) {
      if (linhas[i].startsWith('## ') || linhas[i].startsWith('---')) {
        fim = i;
        break;
      }
    }
    const novas = [...linhas.slice(0, inicio), ...novoConteudo.split('\n'), ...linhas.slice(fim)];
    setEditContent(novas.join('\n'));
  }

  // Renderizador de Markdown para visualização
  function renderMarkdown(md) {
    if (!md) return '';
    const linhas = md.split('\n');

    function wrapTables(html) {
      return html.replace(/(<tr>.*?<\/tr>)+/gs, match =>
        `<div style="overflow-x:auto;margin:12px 0"><table style="border-collapse:collapse;width:100%;font-size:13px">${match}</table></div>`
      );
    }

    const html = linhas.map((linha) => {
      if (linha.startsWith('# ')) return `<h1 style="font-family:var(--font-display);font-size:20px;font-weight:600;margin:24px 0 10px;color:var(--green-dark)">${linha.slice(2)}</h1>`;
      if (linha.startsWith('## ')) return `<h2 style="font-size:17px;font-weight:600;margin:22px 0 8px;color:var(--green);padding-bottom:4px;border-bottom:2px solid var(--green-light)">${linha.slice(3)}</h2>`;
      if (linha.startsWith('### ')) return `<h3 style="font-size:15px;font-weight:600;margin:16px 0 6px;color:var(--text)">${linha.slice(4)}</h3>`;
      if (linha.startsWith('---')) return '<hr style="border:none;border-top:1px solid var(--border);margin:20px 0"/>';
      if (linha.startsWith('- ') || linha.startsWith('• ')) {
        const txt = linha.slice(2);
        return `<div style="display:flex;gap:8px;margin:4px 0;padding-left:8px"><span style="color:var(--green);flex-shrink:0">•</span><span>${formatInline(txt)}</span></div>`;
      }
      if (linha.startsWith('|')) {
        const cells = linha.split('|').filter(c => c.trim() !== '');
        const isSeparator = linha.match(/^\|[-:\s|]+\|$/);
        if (isSeparator) return '';
        const isHeader = linhas[linhas.indexOf(linha) + 1]?.match(/^\|[-:\s|]+\|$/);
        const tag = isHeader ? 'th' : 'td';
        const cellStyle = `padding:6px 10px;border:1px solid var(--border);font-size:12px;${isHeader ? 'background:var(--bg-surface);font-weight:600;' : ''}`;
        return '<tr>' + cells.map(c => `<${tag} style="${cellStyle}">${formatInline(c.trim())}</${tag}>`).join('') + '</tr>';
      }
      if (linha.trim() === '') return '<div style="height:6px"></div>';
      return `<p style="margin:4px 0;line-height:1.75;font-size:14px">${formatInline(linha)}</p>`;
    }).join('');
    return wrapTables(html);
  }

  function formatInline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
  }

  if (loading) return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (!report) return (
    <div className="empty-state">
      <p>Relatório não encontrado.</p>
      <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>Voltar</button>
    </div>
  );

  // Extrai score
  let score = null;
  let secoesPendentes = [];
  try {
    const meta = typeof report.ran_meta === 'string' ? JSON.parse(report.ran_meta) : report.ran_meta;
    score = meta?.revisao?.score_qualidade;
    secoesPendentes = meta?.revisao?.secoes_ausentes || [];
  } catch (e) {}

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => navigate(`/paciente/${patientId}`)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', color: 'var(--green)', fontSize: 14, fontWeight: 500 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
        </button>
        <div style={{ flex: 1 }} />
        {!editing && (
          <>
            <a href={api.downloadDocx(patientId, reportId)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--green)', fontWeight: 500, textDecoration: 'none' }}>
              <Download style={{ width: 16, height: 16 }} /> .docx
            </a>
            {report.drive_file_id && (
              <a href={`https://drive.google.com/file/d/${report.drive_file_id}/view`} target="_blank" rel="noopener"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                <ExternalLink style={{ width: 15, height: 15 }} /> Drive
              </a>
            )}
            <button onClick={() => setEditing(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-secondary)', background: 'none' }}>
              <Pencil style={{ width: 15, height: 15 }} /> Editar
            </button>
          </>
        )}
        {editing && (
          <>
            <button onClick={handleCancelEdit}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)', background: 'none' }}>
              <X style={{ width: 15, height: 15 }} /> Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'white', background: 'var(--green)', padding: '6px 14px', borderRadius: 8, fontWeight: 500 }}>
              {saving ? <div className="spinner" style={{ width: 14, height: 14, borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} /> : <Save style={{ width: 15, height: 15 }} />}
              Salvar
            </button>
          </>
        )}
      </div>

      {/* Banner qualidade */}
      {score !== null && score < 60 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f57f17', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#e65100', display: 'flex', gap: 8 }}>
          <span>⚠</span>
          <div>
            <strong>Rascunho com dados parciais</strong> — Score {score}/100.
            {secoesPendentes.length > 0 && ` Pendente: ${secoesPendentes.join(', ')}.`}
          </div>
        </div>
      )}

      {/* Card info */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>RAN v{report.version}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {new Date(report.generated_at).toLocaleDateString('pt-BR')}
              {report.reviewed_at && ` · Editado em ${new Date(report.reviewed_at).toLocaleDateString('pt-BR')}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {score !== null && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: score >= 60 ? '#e8f5e9' : score >= 40 ? '#fff8e1' : '#ffebee',
                color: score >= 60 ? '#2e7d32' : score >= 40 ? '#f57f17' : '#c62828'
              }}>{score}/100</span>
            )}
            <span className={`badge ${report.status === 'reviewed' ? 'badge-success' : 'badge-warning'}`}>
              {report.status === 'reviewed' ? 'Revisado' : 'Rascunho'}
            </span>
          </div>
        </div>
      </div>

      {/* Modo Edição: navegação por seções */}
      {editing && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 500 }}>
            Editar seção:
          </div>

          {/* Pills das seções */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={() => setSecaoAtiva(null)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                border: '1px solid var(--border)',
                background: secaoAtiva === null ? 'var(--bg-accent)' : 'transparent',
                color: secaoAtiva === null ? 'var(--text-inverse)' : 'var(--text-secondary)',
              }}>
              Texto completo
            </button>
            {SECOES_RAN.map(s => (
              <button key={s} onClick={() => setSecaoAtiva(s)}
                style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                  border: '1px solid var(--border)',
                  background: secaoAtiva === s ? 'var(--bg-accent)' : 'transparent',
                  color: secaoAtiva === s ? 'var(--text-inverse)' : 'var(--text-secondary)',
                }}>
                {s.split(' ').slice(0, 3).join(' ')}
              </button>
            ))}
          </div>

          {/* Textarea da seção ou do texto completo */}
          {secaoAtiva === null ? (
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{
                width: '100%', minHeight: 400, padding: 14, borderRadius: 8,
                border: '1px solid var(--border)', fontSize: 13, fontFamily: 'monospace',
                lineHeight: 1.6, resize: 'vertical', background: 'var(--bg-card)', color: 'var(--text)'
              }}
            />
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6, padding: '6px 10px', background: 'var(--amber-light)', borderRadius: 6 }}>
                Editando seção: <strong>{secaoAtiva}</strong>. Mantenha o título ## no início.
              </div>
              <textarea
                value={getSecao(secaoAtiva)}
                onChange={e => setSecao(secaoAtiva, e.target.value)}
                style={{
                  width: '100%', minHeight: 300, padding: 14, borderRadius: 8,
                  border: '1px solid var(--amber)', fontSize: 13, fontFamily: 'monospace',
                  lineHeight: 1.6, resize: 'vertical', background: 'var(--bg-card)', color: 'var(--text)'
                }}
              />
            </>
          )}

          {/* Preview em tempo real */}
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>
            Pré-visualização:
          </div>
          <div className="card" style={{ fontSize: 13, maxHeight: 300, overflowY: 'auto' }}>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(secaoAtiva ? getSecao(secaoAtiva) : editContent.slice(0, 2000)) }} />
          </div>
        </div>
      )}

      {/* Visualização do relatório */}
      {!editing && (
        <div className="card" style={{ fontSize: 14 }}>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content_md || '') }} />
        </div>
      )}
    </div>
  );
}
