import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Login } from './pages/Login';
import { TherapistLayout } from './pages/therapist/Layout';
import { Dashboard } from './pages/therapist/Dashboard';
import { PatientSheet, PatientSection } from './pages/therapist/PatientSheet';
import { CalibrationWizard } from './pages/therapist/CalibrationWizard';
import { Exercises } from './pages/therapist/Exercises';
import { ResearchList, StudyDetail } from './pages/therapist/Research';
import { Settings } from './pages/therapist/Settings';
import { PatientHome } from './pages/patient/PatientHome';
import { TouchCheck } from './pages/TouchCheck';
import { Loading } from './components/ui';

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-wrap"><Loading what="Avvio di Hand Lab…" /></div>;
  if (!user) return <Login />;
  if (user.role === 'patient') {
    return (
      <Routes>
        <Route path="/verifica" element={<TouchCheck />} />
        <Route path="*" element={<PatientHome />} />
      </Routes>
    );
  }
  if (user.role === 'admin') {
    return (
      <Routes>
        <Route element={<TherapistLayout />}>
          <Route path="/impostazioni" element={<Settings />} />
        </Route>
        <Route path="/verifica" element={<TouchCheck />} />
        <Route path="*" element={<Navigate to="/impostazioni" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/verifica" element={<TouchCheck />} />
      <Route path="/taratura/:id/nuova" element={<div className="main" style={{ margin: '0 auto' }}><CalibrationWizard /></div>} />
      <Route element={<TherapistLayout />}>
        <Route path="/pazienti" element={<Dashboard />} />
        <Route path="/pazienti/:id" element={<PatientSheet />} />
        <Route path="/taratura" element={<PatientSection title="Taratura" tab="calibration" intro="Tarature versionate per paziente: iniziale di riferimento e nuove tarature, senza cancellare le precedenti." />} />
        <Route path="/programmi" element={<PatientSection title="Programmi" tab="program" intro="Programma personalizzato e storico delle versioni." />} />
        <Route path="/valutazioni" element={<PatientSection title="Valutazioni" tab="assessments" intro="Misure cliniche, questionari (inserimento manuale) e prove touchscreen a condizioni fisse." />} />
        <Route path="/progressi" element={<PatientSection title="Progressi" tab="progress" intro="Andamento nel tempo, separando dati riferiti, prestazioni touchscreen e misure cliniche." />} />
        <Route path="/esercizi" element={<Exercises />} />
        <Route path="/ricerca" element={<ResearchList />} />
        <Route path="/ricerca/:id" element={<StudyDetail />} />
        <Route path="/impostazioni" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/pazienti" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </BrowserRouter>
  );
}
