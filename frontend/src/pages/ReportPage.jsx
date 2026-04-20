import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { api } from '../utils/api';

export default function ReportPage() {
  const { patientId, reportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getReport(patientId, reportId)
      .then(setReport)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [patientId, reportId]);

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  if (!report) {
    return (
      <div className="empty-state">
        <p>Relatório não encontrado.</p>
        <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>Voltar</button>
      </div>
    );
  }

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.split('\n');

    function wrapTables(html) {
      return html.replace(/(<tr>.*?<\/tr>)+/gs, match =>
        `<div style="overflow-x:auto;margin:12px 0"><table style="border-collapse:collapse;width:100%;font-size:13px">${match}</table></div>`
      );
    }

    const html = lines.map((line) => {
      if (line.startsWith('# ')) return `<h1 style="font-family:var(--font-display);font-size:22px;font-weight:600;margin:28px 0 12px;color:var(--green-dark)">${line.slice(2)}</h1>`;
      if (line.startsWith('## ')) return `<h2 style="font-size:18px;font-weight:500;margin:24px 0 10px;color:var(--text)">${line.slice(3)}</h2>`;
      if (line.startsWith('### ')) return `<h3 style="font-size:16px;font-weight:500;margin:20px 0 8px;color:var(--text)">${line.slice(4)}</h3>`;
      if (line.startsWith('---')) return '<hr style="border:none;border-top:1px solid var(--border);margin:24px 0"/>';
      if (line.startsWith('- ')) return `<div style="display:flex;gap:8px;margin:4px 0;padding-left:8px"><span style="color:var(--green)">•</span><span>${formatInline(line.slice(2))}</span></div>`;
      if (line.startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim() !== '');
        const isSeparator = line.match(/^\|[-:\s|]+\|$/);
        if (isSeparator) return '';
        const isHeader = lines[lines.indexOf(line) + 1]?.match(/^\|[-:\s|]+\|$/);
        const tag = isHeader ? 'th' : 'td';
        const cellStyle = `padding:6px 12px;border:1px solid var(--border);font-size:13px;${isHeader ? 'background:var(--bg-surface);font-weight:500;' : ''}`;
        return '<tr>' + cells.map(c => `<${tag} style="${cellStyle}">${formatInline(c.trim())}</${tag}>`).join('') + '</tr>';
      }
      if (line.trim() === '') return '<br/>';
      return `<p style="margin:4px 0;line-height:1.7">${formatInline(line)}</p>`;
    }).join('');

    return wrapTables(html);
  }

  function formatInline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:var(--bg-surface);padding:1px 6px;border-radius:4px;font-size:13px">$1</code>');
  }

  // Extrai score do ran_meta
  let score = null;
  let secoesPendentes = [];
  try {
    const meta = typeof report.ran_meta === 'string' ? JSON.parse(report.ran_meta) : report.ran_meta;
    score = meta?.revisao?.score_qualidade;
    secoesPendentes = meta?.revisao?.secoes_ausentes || [];
  } catch (e) {}

  return (
    <div>
      <button onClick={() => navigate(`/paciente/${patientId}`)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 16, fontWeight: 500 }}>
        <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
      </button>

      {/* Banner de qualidade parcial */}
      {score !== null && score < 60 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f57f17', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#e65100', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <div>
            <strong>Rascunho com dados parciais</strong> — Score {score}/100.
            {secoesPendentes.length > 0 && ` Seções pendentes: ${secoesPendentes.join(', ')}.`}
            {' '}Complete a anamnese e clique em "Atualizar RAN".
          </div>
        </div>
      )}

      {/* Cabeçalho do relatório */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 500 }}>{report.patient_id ? 'Relatório de Avaliação' : 'Relatório'}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              Versão {report.version} · {new Date(report.generated_at).toLocaleDateString('pt-BR')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {score !== null && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: score >= 60 ? '#e8f5e9' : score >= 40 ? '#fff8e1' : '#ffebee',
                color: score >= 60 ? '#2e7d32' : score >= 40 ? '#f57f17' : '#c62828'
              }}>{score}/100</span>
            )}
            <span className={`badge ${report.status === 'draft' ? 'badge-warning' : 'badge-success'}`}>
              {report.status === 'draft' ? 'Rascunho' : 'Revisado'}
            </span>
          </div>
        </div>
      </div>

      {/* Botão Drive */}
      {report.drive_file_id && (
        <a href={`https://drive.google.com/file/d/${report.drive_file_id}/view`} target="_blank" rel="noopener"
          className="btn btn-outline btn-block" style={{ marginBottom: 16, fontSize: 14 }}>
          <Download style={{ width: 16, height: 16 }} /> Abrir no Google Drive
        </a>
      )}

      {/* Conteúdo do relatório */}
      <div className="card" style={{ fontSize: 14 }}>
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content_md || '') }} />
      </div>
    </div>
  );
}
