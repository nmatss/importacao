import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/shared/hooks/useAuth';
import { ImportacaoLayout } from '@/shared/components/ImportacaoLayout';
import { CertificacoesLayout } from '@/shared/components/CertificacoesLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { PortalPage } from '@/features/portal/PortalPage';

// Lazy-loaded Importacao pages
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ProcessListPage = lazy(() => import('@/features/processes/ProcessListPage').then(m => ({ default: m.ProcessListPage })));
const ProcessDetailPage = lazy(() => import('@/features/processes/ProcessDetailPage').then(m => ({ default: m.ProcessDetailPage })));
const ProcessCreatePage = lazy(() => import('@/features/processes/ProcessCreatePage').then(m => ({ default: m.ProcessCreatePage })));
const ProcessEditPage = lazy(() => import('@/features/processes/ProcessEditPage').then(m => ({ default: m.ProcessEditPage })));
const CurrencyExchangePage = lazy(() => import('@/features/currency-exchange/CurrencyExchangePage').then(m => ({ default: m.CurrencyExchangePage })));
const FollowUpPage = lazy(() => import('@/features/follow-up/FollowUpPage').then(m => ({ default: m.FollowUpPage })));
const CommunicationsPage = lazy(() => import('@/features/communications/CommunicationsPage').then(m => ({ default: m.CommunicationsPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AlertsPage = lazy(() => import('@/features/alerts/AlertsPage').then(m => ({ default: m.AlertsPage })));
const EmailIngestionPage = lazy(() => import('@/features/email-ingestion/EmailIngestionPage').then(m => ({ default: m.EmailIngestionPage })));
const AuditLogPage = lazy(() => import('@/features/audit/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const LiTrackingPage = lazy(() => import('@/features/li-tracking/LiTrackingPage').then(m => ({ default: m.LiTrackingPage })));
const DesembaracoPage = lazy(() => import('@/features/desembaraco/DesembaracoPage').then(m => ({ default: m.DesembaracoPage })));
const NumerarioPage = lazy(() => import('@/features/numerario/NumerarioPage').then(m => ({ default: m.NumerarioPage })));
const MeuDiaPage = lazy(() => import('@/features/dashboard/MeuDiaPage').then(m => ({ default: m.MeuDiaPage })));
const ExecutiveDashboardPage = lazy(() => import('@/features/dashboard/ExecutiveDashboardPage').then(m => ({ default: m.ExecutiveDashboardPage })));

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
              <Suspense fallback={<LazyFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/importacao/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/meu-dia" element={<MeuDiaPage />} />
                  <Route path="/executivo" element={<ExecutiveDashboardPage />} />
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
              </Suspense>
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
