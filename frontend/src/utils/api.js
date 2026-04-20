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
  deleteFile: (patientId, fileId) => request(`/files/${patientId}/${fileId}`, { method: 'DELETE' }),

  // Reports
  generateReport: (patientId, force = false, forceSave = false) =>
    request(`/reports/generate/${patientId}`, { method: 'POST', body: JSON.stringify({ force, force_save: forceSave }) }),
  getReport: (patientId, reportId) => request(`/reports/${patientId}/${reportId}`),
  getPatientReports: (patientId) => request(`/reports/patient/${patientId}`),
  updateReport: (patientId, reportId, force = false) =>
    request(`/reports/update/${patientId}/${reportId}`, { method: 'POST', body: JSON.stringify({ force }) }),
  editReport: (patientId, reportId, contentMd) =>
    request(`/reports/${patientId}/${reportId}`, { method: 'PATCH', body: JSON.stringify({ content_md: contentMd }) }),
  downloadDocx: (patientId, reportId) =>
    `${BASE}/reports/${patientId}/${reportId}/docx`,
};
