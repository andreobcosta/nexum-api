import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Users, FolderPlus, FileText } from 'lucide-react';
import PatientsPage from './pages/PatientsPage';
import PatientDetailPage from './pages/PatientDetailPage';
import UploadPage from './pages/UploadPage';
import ReportPage from './pages/ReportPage';
import NewPatientPage from './pages/NewPatientPage';
import './index.css';

function Header() {
  return (
    <div className="header">
      <div className="header-logo">R</div>
      <div>
        <div className="header-title">RAN Clinic</div>
        <div className="header-subtitle">Patrízia Santarém</div>
      </div>
    </div>
  );
}

function BottomNav() {
  const location = useLocation();
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
      <NavLink to="/relatorios" className={`nav-item ${location.pathname.startsWith('/relatorio') ? 'active' : ''}`}>
        <FileText />
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
            <Route path="/paciente/:id/enviar" element={<UploadPage />} />
            <Route path="/relatorio/:id" element={<ReportPage />} />
            <Route path="/relatorios" element={<PatientsPage showReportsOnly />} />
          </Routes>
        </div>
        <BottomNav />
      </div>
    </BrowserRouter>
  );
}
