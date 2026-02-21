import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { Layout } from '@/shared/components/Layout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProcessListPage } from '@/features/processes/ProcessListPage';
import { ProcessDetailPage } from '@/features/processes/ProcessDetailPage';
import { ProcessCreatePage } from '@/features/processes/ProcessCreatePage';
import { CurrencyExchangePage } from '@/features/currency-exchange/CurrencyExchangePage';
import { FollowUpPage } from '@/features/follow-up/FollowUpPage';
import { CommunicationsPage } from '@/features/communications/CommunicationsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AlertsPage } from '@/features/alerts/AlertsPage';
import { EmailIngestionPage } from '@/features/email-ingestion/EmailIngestionPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/processos" element={<ProcessListPage />} />
                <Route path="/processos/novo" element={<ProcessCreatePage />} />
                <Route path="/processos/:id" element={<ProcessDetailPage />} />
                <Route path="/cambios" element={<CurrencyExchangePage />} />
                <Route path="/follow-up" element={<FollowUpPage />} />
                <Route path="/comunicacoes" element={<CommunicationsPage />} />
                <Route path="/alertas" element={<AlertsPage />} />
                <Route path="/email-ingestion" element={<EmailIngestionPage />} />
                <Route path="/configuracoes" element={<SettingsPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
