import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api } from '../utils/api';

export default function NewPatientPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    full_name: '', birth_date: '', age: '', grade: '',
    handedness: 'Destro', medications: '', guardians: ''
  });

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setLoading(true);
    try {
      const result = await api.createPatient({
        ...form,
        age: form.age ? parseInt(form.age) : null,
        full_name: form.full_name.trim()
      });
      navigate(`/paciente/${result.id}`);
    } catch (err) {
      alert('Erro ao criar paciente: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <UserPlus style={{ width: 24, height: 24, color: 'var(--green)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Novo paciente</h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label>Nome completo *</label>
          <input className="input-field" placeholder="Nome da criança" value={form.full_name} onChange={set('full_name')} required />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="input-group">
            <label>Data de nascimento</label>
            <input className="input-field" type="date" value={form.birth_date} onChange={set('birth_date')} />
          </div>
          <div className="input-group">
            <label>Idade</label>
            <input className="input-field" type="number" placeholder="9" value={form.age} onChange={set('age')} />
          </div>
        </div>

        <div className="input-group">
          <label>Escolaridade</label>
          <input className="input-field" placeholder="4º Ano Fundamental" value={form.grade} onChange={set('grade')} />
        </div>

        <div className="input-group">
          <label>Dominância manual</label>
          <select className="input-field" value={form.handedness} onChange={set('handedness')}>
            <option>Destro</option>
            <option>Canhoto</option>
            <option>Ambidestro</option>
            <option>Não definida</option>
          </select>
        </div>

        <div className="input-group">
          <label>Medicamentos em uso</label>
          <input className="input-field" placeholder="Ritalina, Rispiridona..." value={form.medications} onChange={set('medications')} />
        </div>

        <div className="input-group">
          <label>Responsáveis</label>
          <input className="input-field" placeholder="Nomes dos pais/responsáveis" value={form.guardians} onChange={set('guardians')} />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}
          style={{ marginTop: 8, height: 52 }}>
          {loading ? <div className="spinner" style={{ borderTopColor: 'white' }} /> : 'Criar paciente e pastas no Drive'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
          As 6 pastas serão criadas automaticamente no Google Drive
        </p>
      </form>
    </div>
  );
}
