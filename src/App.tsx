import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ClinicProvider } from "./components/ClinicProvider";
import { SyncProvider } from "./sync";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import GeneratedReports from "./pages/GeneratedReports";
import GenerateReport from "./pages/GenerateReport";
import Lab from "./pages/Lab";
import LabCatalog from "./pages/LabCatalog";
import Login from "./pages/Login";
import Opd from "./pages/Opd";
import OpdSettings from "./pages/OpdSettings";
import Pets from "./pages/Pets";
import PetDetail from "./pages/PetDetail";
import Hospitalization from "./pages/Hospitalization";
import Clinic from "./pages/Clinic";
import "./App.css";

function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <ClinicProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pets" element={<Pets />} />
              <Route path="/pets/:id" element={<PetDetail />} />
              <Route path="/hospitalization" element={<Hospitalization />} />
              <Route path="/lab" element={<Lab />} />
              <Route path="/opd" element={<Opd />} />
              <Route path="/opd-settings" element={<OpdSettings />} />
              <Route path="/clinic" element={<Clinic />} />
              <Route path="/lab-catalog" element={<LabCatalog />} />
              <Route path="/reports/generated" element={<GeneratedReports />} />
              <Route path="/reports" element={<GenerateReport />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </ClinicProvider>
      </SyncProvider>
    </AuthProvider>
  );
}

export default App;
