import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { api } from '../utils/api';

export default function EditPatientPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    full_name: '', birth_date: '', age: '', grade: '',
    handedness: 'Destro', medications: '', guardians: ''
  });

  useEffect(() => {
    api.getPatient(id).then(p => {
      setForm({
        full_name: p.full_name || '',
        birth_date: p.birth_date || '',
        age: p.age || '',
        grade: p.grade || '',
        handedness: p.handedness || 'Destro',
        medications: p.medications || '',
        guardians: p.guardians || '',
      });
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    if (!form.full_name.trim()) return;
    setSaving(true);
    try {
      await api.updatePatient(id, {
        ...form,
        age: form.age ? parseInt(form.age) : null,
        full_name: form.full_name.trim()
      });
      showToast('Dados salvos com sucesso!');
      setTimeout(() => navigate(`/paciente/${id}`), 1200);
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await api.deletePatient(id);
      navigate('/');
    } catch (err) {
      showToast('Erro ao excluir: ' + err.message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <button onClick={() => navigate(`/paciente/${id}`)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', color: 'var(--green)', fontSize: 14, marginBottom: 24, fontWeight: 500 }}>
        <ArrowLeft style={{ width: 18, height: 18 }} /> Voltar
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 24 }}>Editar paciente</h2>

      <div className="input-group">
        <label>Nome completo *</label>
        <input className="input-field" value={form.full_name} onChange={set('full_name')} required />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group">
          <label>Data de nascimento</label>
          <input className="input-field" type="date" value={form.birth_date} onChange={set('birth_date')} />
        </div>
        <div className="input-group">
          <label>Idade</label>
          <input className="input-field" type="number" value={form.age} onChange={set('age')} />
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

      <button className="btn btn-primary btn-block" onClick={handleSave} disabled={saving}
        style={{ height: 52, marginBottom: 12 }}>
        {saving ? <div className="spinner" style={{ borderTopColor: 'white' }} /> : <><Save style={{ width: 16, height: 16 }} /> Salvar alterações</>}
      </button>

      <button className="btn btn-block" onClick={handleDelete} disabled={deleting}
        style={{ height: 48, background: confirmDelete ? 'var(--red)' : 'transparent', border: '1px solid var(--red)', color: confirmDelete ? 'white' : 'var(--red)', fontSize: 14 }}>
        {deleting ? <div className="spinner" style={{ borderTopColor: confirmDelete ? 'white' : 'var(--red)' }} /> :
          <><Trash2 style={{ width: 16, height: 16 }} /> {confirmDelete ? 'Confirmar exclusão do paciente' : 'Excluir paciente'}</>}
      </button>
      {confirmDelete && (
        <p style={{ fontSize: 12, color: 'var(--red)', textAlign: 'center', marginTop: 8 }}>
          Os arquivos no Drive serão mantidos. Clique novamente para confirmar.
        </p>
      )}
    </div>
  );
}
