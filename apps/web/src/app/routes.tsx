import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { ImportacaoLayout } from '@/shared/components/ImportacaoLayout';
import { CertificacoesLayout } from '@/shared/components/CertificacoesLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { PortalPage } from '@/features/portal/PortalPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProcessListPage } from '@/features/processes/ProcessListPage';
import { ProcessDetailPage } from '@/features/processes/ProcessDetailPage';
import { ProcessCreatePage } from '@/features/processes/ProcessCreatePage';
import { ProcessEditPage } from '@/features/processes/ProcessEditPage';
import { CurrencyExchangePage } from '@/features/currency-exchange/CurrencyExchangePage';
import { FollowUpPage } from '@/features/follow-up/FollowUpPage';
import { CommunicationsPage } from '@/features/communications/CommunicationsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AlertsPage } from '@/features/alerts/AlertsPage';
import { EmailIngestionPage } from '@/features/email-ingestion/EmailIngestionPage';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { LiTrackingPage } from '@/features/li-tracking/LiTrackingPage';
import { DesembaracoPage } from '@/features/desembaraco/DesembaracoPage';
import { NumerarioPage } from '@/features/numerario/NumerarioPage';

// Lazy-loaded Certificacoes pages
const CertDashboardPage = lazy(() => import('@/features/certificacoes/CertDashboardPage'));
const CertValidacaoPage = lazy(() => import('@/features/certificacoes/CertValidacaoPage'));
const CertProdutosPage = lazy(() => import('@/features/certificacoes/CertProdutosPage'));
const CertProdutoDetailPage = lazy(() => import('@/features/certificacoes/CertProdutoDetailPage'));
const CertRelatoriosPage = lazy(() => import('@/features/certificacoes/CertRelatoriosPage'));
const CertRelatorioDetailPage = lazy(() => import('@/features/certificacoes/CertRelatorioDetailPage'));
const CertAgendamentosPage = lazy(() => import('@/features/certificacoes/CertAgendamentosPage'));
const CertConfiguracoesPage = lazy(() => import('@/features/certificacoes/CertConfiguracoesPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Portal */}
      <Route
        path="/portal"
        element={
          <ProtectedRoute>
            <PortalPage />
          </ProtectedRoute>
        }
      />

      {/* Importacao module */}
      <Route
        path="/importacao/*"
        element={
          <ProtectedRoute>
            <ImportacaoLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/importacao/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/processos" element={<ProcessListPage />} />
                <Route path="/processos/novo" element={<ProcessCreatePage />} />
                <Route path="/processos/:id" element={<ProcessDetailPage />} />
                <Route path="/processos/:id/editar" element={<ProcessEditPage />} />
                <Route path="/cambios" element={<CurrencyExchangePage />} />
                <Route path="/lis" element={<LiTrackingPage />} />
                <Route path="/desembaraco" element={<DesembaracoPage />} />
                <Route path="/numerario" element={<NumerarioPage />} />
                <Route path="/follow-up" element={<FollowUpPage />} />
                <Route path="/comunicacoes" element={<CommunicationsPage />} />
                <Route path="/alertas" element={<AlertsPage />} />
                <Route path="/email-ingestion" element={<EmailIngestionPage />} />
                <Route path="/auditoria" element={<AuditLogPage />} />
                <Route path="/configuracoes" element={<SettingsPage />} />
              </Routes>
            </ImportacaoLayout>
          </ProtectedRoute>
        }
      />

      {/* Certificacoes module */}
      <Route
        path="/certificacoes/*"
        element={
          <ProtectedRoute>
            <CertificacoesLayout>
              <Suspense fallback={<LazyFallback />}>
                <Routes>
                  <Route path="/" element={<CertDashboardPage />} />
                  <Route path="/validacao" element={<CertValidacaoPage />} />
                  <Route path="/produtos" element={<CertProdutosPage />} />
                  <Route path="/produtos/:sku" element={<CertProdutoDetailPage />} />
                  <Route path="/relatorios" element={<CertRelatoriosPage />} />
                  <Route path="/relatorios/:id" element={<CertRelatorioDetailPage />} />
                  <Route path="/agendamentos" element={<CertAgendamentosPage />} />
                  <Route path="/configuracoes" element={<CertConfiguracoesPage />} />
                </Routes>
              </Suspense>
            </CertificacoesLayout>
          </ProtectedRoute>
        }
      />

      {/* Redirects for old routes */}
      <Route path="/dashboard" element={<Navigate to="/portal" replace />} />
      <Route path="/processos/*" element={<Navigate to="/importacao/processos" replace />} />
      <Route path="/" element={<Navigate to="/portal" replace />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  );
}
