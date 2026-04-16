import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { api } from '../utils/api';

export default function PatientsPage({ showReportsOnly }) {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.getPatients().then(setPatients).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = patients.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const display = showReportsOnly ? filtered.filter((p) => p.completeness.reports > 0) : filtered;

  function getStatusBadge(p) {
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
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search style={{ position: 'absolute', left: 14, top: 12, width: 18, height: 18, color: 'var(--text-muted)' }} />
        <input
          className="input-field"
          style={{ paddingLeft: 40 }}
          placeholder="Buscar paciente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {display.length === 0 ? (
        <div className="empty-state">
          <p>{showReportsOnly ? 'Nenhum relatório gerado ainda.' : 'Nenhum paciente cadastrado.'}</p>
          {!showReportsOnly && (
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
                <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>{p.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {p.completeness.anamnese} anamnese · {p.completeness.teste} testes · {p.completeness.sessao} sessões
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
