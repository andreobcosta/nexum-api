import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { api } from '../utils/api';

export default function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getReport(id).then(setReport).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  if (!report) {
    return <div className="empty-state"><p>Relatório não encontrado.</p></div>;
  }

  // Simple markdown-to-html (headings, bold, lists, tables, hr)
  function renderMarkdown(md) {
    const lines = md.split('\n');
    // Processa tabelas: agrupa linhas <tr> em <table>
    function wrapTables(html) {
      return html
        .replace(/(<tr>.*?<\/tr>)+/gs, match => 
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
        // Renderiza linha de tabela como row de grid
        const cells = line.split('|').filter(c => c.trim() !== '');
        const isHeader = lines[lines.indexOf(line) + 1]?.match(/^\|[-:\s|]+\|$/);
        const isSeparator = line.match(/^\|[-:\s|]+\|$/);
        if (isSeparator) return ''; // pula linha de separador
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

  return (
    <div>
      <button onClick={() => navigate(-1)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 16, fontWeight: 500 }}>
        <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
      </button>

      {report.ran_meta && (() => {
        try {
          const meta = typeof report.ran_meta === 'string' ? JSON.parse(report.ran_meta) : report.ran_meta;
          const score = meta?.revisao?.score_qualidade;
          if (score !== undefined && score < 60) {
            return (
              <div style={{ background: '#fff8e1', border: '1px solid #f57f17', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#e65100', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16 }}>⚠</span>
                <div>
                  <strong>Rascunho com dados parciais</strong> — Score {score}/100.
                  {meta?.revisao?.secoes_ausentes?.length > 0 && ` Seções pendentes: ${meta.revisao.secoes_ausentes.join(', ')}.`}
                  {' '}Revise e complete os dados faltantes antes de finalizar.
                </div>
              </div>
            );
          }
        } catch(e) {}
        return null;
      })()}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500 }}>{report.full_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              Versão {report.version} · {new Date(report.generated_at).toLocaleDateString('pt-BR')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={`badge ${report.status === 'draft' ? 'badge-warning' : 'badge-success'}`}>
              {report.status === 'draft' ? 'Rascunho' : 'Revisado'}
            </span>
          </div>
        </div>
      </div>

      {report.drive_file_id && (
        <a href={`https://drive.google.com/file/d/${report.drive_file_id}/view`} target="_blank" rel="noopener"
          className="btn btn-outline btn-block" style={{ marginBottom: 16, fontSize: 14 }}>
          <Download style={{ width: 16, height: 16 }} /> Abrir no Google Drive
        </a>
      )}

      <div className="card" style={{ fontSize: 14 }}>
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content_md || '') }} />
      </div>
    </div>
  );
}
