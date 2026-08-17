import { Navigate, Route, Routes } from 'react-router-dom';
import PosPage from './pages/POS/index.jsx';
import { ToastProvider } from './hooks/useToast.jsx';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<PosPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
