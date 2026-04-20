import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Users, FolderPlus, FileText, Pencil } from 'lucide-react';
import PatientsPage from './pages/PatientsPage';
import PatientDetailPage from './pages/PatientDetailPage';
import EditPatientPage from './pages/EditPatientPage';
import UploadPage from './pages/UploadPage';
import ReportPage from './pages/ReportPage';
import NewPatientPage from './pages/NewPatientPage';
import { api } from './utils/api';
import './index.css';

function Header() {
  const location = useLocation();
  const navigate = useNavigate();

  // Mostra nome do paciente em telas de detalhe
  const patientMatch = location.pathname.match(/^\/paciente\/([^/]+)/);
  const reportMatch = location.pathname.match(/^\/relatorio\//);
  const isDetailPage = patientMatch || reportMatch;

  return (
    <div className="header">
      <div className="header-logo">R</div>
      <div style={{ flex: 1 }}>
        <div className="header-title">RAN Clinic</div>
        <div className="header-subtitle">Patrízia Santarém</div>
      </div>
      {patientMatch && !location.pathname.includes('/enviar') && !location.pathname.includes('/editar') && (
        <button
          onClick={() => navigate(`/paciente/${patientMatch[1]}/editar`)}
          style={{ background: 'none', color: 'var(--text-secondary)', padding: 8 }}>
          <Pencil style={{ width: 18, height: 18 }} />
        </button>
      )}
    </div>
  );
}

function BottomNav() {
  const location = useLocation();
  const [reportCount, setReportCount] = useState(0);

  useEffect(() => {
    api.getPatients().then(ps => {
      setReportCount(ps.reduce((sum, p) => sum + (p.completeness?.reports || 0), 0));
    }).catch(() => {});
  }, []);

  return (
    <nav className="bottom-nav">
      <NavLink to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
        <Users />
        <span>Pacientes</span>
      </NavLink>
      <NavLink to="/novo" className={`nav-item ${location.pathname === '/novo' ? 'active' : ''}`}>
        <FolderPlus />
        <span>Novo</span>
      </NavLink>
      <NavLink to="/relatorios" className={`nav-item ${location.pathname.startsWith('/relatorio') ? 'active' : ''}`}
        style={{ position: 'relative' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <FileText />
          {reportCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -8,
              background: 'var(--green)', color: 'white',
              fontSize: 9, fontWeight: 600, borderRadius: 10,
              padding: '1px 5px', lineHeight: '14px'
            }}>{reportCount}</span>
          )}
        </div>
        <span>Relatórios</span>
      </NavLink>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Header />
        <div className="page">
          <Routes>
            <Route path="/" element={<PatientsPage />} />
            <Route path="/novo" element={<NewPatientPage />} />
            <Route path="/paciente/:id" element={<PatientDetailPage />} />
            <Route path="/paciente/:id/editar" element={<EditPatientPage />} />
            <Route path="/paciente/:id/enviar" element={<UploadPage />} />
            <Route path="/relatorio/:patientId/:reportId" element={<ReportPage />} />
            <Route path="/relatorios" element={<PatientsPage showReportsOnly />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </BrowserRouter>
  );
}
