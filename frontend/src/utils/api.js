const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Erro na requisição');
  }
  return res.json();
}

export const api = {
  // Patients
  getPatients: () => request('/patients'),
  getPatient: (id) => request(`/patients/${id}`),
  createPatient: (data) => request('/patients', { method: 'POST', body: JSON.stringify(data) }),
  updatePatient: (id, data) => request(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),

  // Files
  uploadFile: (formData) =>
    fetch(`${BASE}/files/upload`, { method: 'POST', body: formData }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    }),
  saveNote: (data) => request('/files/note', { method: 'POST', body: JSON.stringify(data) }),
  getPatientFiles: (patientId) => request(`/files/patient/${patientId}`),

  // Reports
  generateReport: (patientId, force = false) =>
    request(`/reports/generate/${patientId}`, { method: 'POST', body: JSON.stringify({ force }) }),
  getReport: (id) => request(`/reports/${id}`),
  getPatientReports: (patientId) => request(`/reports/patient/${patientId}`),
};
