import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../utils/api';

export default function PatientsPage({ showReportsOnly }) {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.getPatients().then(setPatients).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = patients.filter((p) => {
    const matchName = p.full_name.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === 'all' ? true :
      statusFilter === 'pronto' ? p.ready_for_ran :
      statusFilter === 'pendente' ? !p.ready_for_ran :
      statusFilter === 'ran' ? p.completeness.reports > 0 : true;
    return matchName && matchStatus;
  });

  const display = showReportsOnly ? filtered.filter((p) => p.completeness.reports > 0) : filtered;

  function getStatusBadge(p) {
    if (p.completeness.reports > 0) return (
      <span className="badge badge-info">{p.completeness.reports} RAN{p.completeness.reports > 1 ? 's' : ''}</span>
    );
    if (p.ready_for_ran) return <span className="badge badge-success">Pronto p/ RAN</span>;
    const missing = [];
    if (!p.completeness.anamnese) missing.push('Anamnese');
    if (!p.completeness.teste) missing.push('Testes');
    if (!p.completeness.sessao) missing.push('Sessões');
    return <span className="badge badge-warning">Falta: {missing.join(', ')}</span>;
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 16 }}>Carregando pacientes...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Busca */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search style={{ position: 'absolute', left: 14, top: 12, width: 18, height: 18, color: 'var(--text-muted)' }} />
        <input
          className="input-field"
          style={{ paddingLeft: 40 }}
          placeholder="Buscar paciente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filtro de status */}
      {!showReportsOnly && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { value: 'all', label: 'Todos' },
            { value: 'ran', label: 'Com RAN' },
            { value: 'pronto', label: 'Prontos' },
            { value: 'pendente', label: 'Pendentes' },
          ].map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, flexShrink: 0,
                border: '1px solid var(--border)',
                background: statusFilter === f.value ? 'var(--bg-accent)' : 'transparent',
                color: statusFilter === f.value ? 'var(--text-inverse)' : 'var(--text-secondary)',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {display.length === 0 ? (
        <div className="empty-state">
          {/* Ilustração SVG */}
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ margin: '0 auto 16px', display: 'block', opacity: 0.35 }}>
            <circle cx="40" cy="30" r="18" stroke="var(--text-muted)" strokeWidth="2.5" fill="none"/>
            <circle cx="40" cy="26" r="7" stroke="var(--text-muted)" strokeWidth="2" fill="none"/>
            <path d="M16 62c0-13.25 10.75-24 24-24s24 10.75 24 24" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
          </svg>
          <p>{showReportsOnly ? 'Nenhum relatório gerado ainda.' : search ? 'Nenhum resultado encontrado.' : 'Nenhum paciente cadastrado.'}</p>
          {!showReportsOnly && !search && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/novo')}>
              Cadastrar primeiro paciente
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {display.map((p) => (
            <button key={p.id} className="card" onClick={() => navigate(`/paciente/${p.id}`)}
              style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: 'var(--bg-accent-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--green-dark)', fontWeight: 600, fontSize: 16, flexShrink: 0
              }}>
                {p.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {[p.age && `${p.age} anos`, p.grade].filter(Boolean).join(' · ') || 'Sem dados'}
                </div>
                {getStatusBadge(p)}
              </div>
              <ChevronRight style={{ width: 20, height: 20, color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
