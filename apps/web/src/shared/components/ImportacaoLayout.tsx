import {
  LayoutDashboard,
  FileBox,
  DollarSign,
  CalendarClock,
  Mail,
  Bell,
  Inbox,
  Shield,
  Settings,
  FileCheck,
  Building2,
  Wallet,
  BarChart3,
  ClipboardList,
  Bot,
  ReceiptText,
} from 'lucide-react';
import {
  AppLayout,
  type AppNavItem,
  type AppNavSection,
  type AppHeaderInfo,
} from '@/shared/components/AppLayout';

// Wrapper fino sobre o AppLayout (shell único — auditoria 2026-07-17). Este
// arquivo só carrega o que é do módulo: nav, accent, health e títulos.

const navSections: AppNavSection[] = [
  {
    label: 'Principal',
    items: [
      { to: '/importacao/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/importacao/meu-dia', label: 'Meu Dia', icon: CalendarClock },
      { to: '/importacao/executivo', label: 'Executivo', icon: BarChart3 },
      { to: '/importacao/processos', label: 'Processos', icon: FileBox },
    ],
  },
  {
    label: 'Operacional',
    items: [
      { to: '/importacao/pre-cons', label: 'Pré-Conferência', icon: ClipboardList },
      {
        to: '/importacao/compras-pagamentos',
        label: 'Compras/Pagamentos SYDLE',
        icon: ReceiptText,
      },
      { to: '/importacao/cambios', label: 'Câmbios', icon: DollarSign },
      { to: '/importacao/lis', label: 'LIs / LPCOs', icon: FileCheck },
      { to: '/importacao/desembaraco', label: 'Desembaraço', icon: Building2 },
      { to: '/importacao/numerario', label: 'Numerário', icon: Wallet },
    ],
  },
  {
    label: 'Acompanhamento',
    items: [
      { to: '/importacao/follow-up', label: 'Follow-Up', icon: CalendarClock },
      { to: '/importacao/assistente', label: 'Assistente', icon: Bot },
      { to: '/importacao/comunicacoes', label: 'Atendimentos', icon: Mail },
      { to: '/importacao/alertas', label: 'Central de Alertas', icon: Bell },
      { to: '/importacao/email-ingestion', label: 'E-mail', icon: Inbox },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/importacao/auditoria', label: 'Auditoria', icon: Shield },
      { to: '/importacao/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

const pageTitles: Record<string, string> = {
  '/importacao/dashboard': 'Dashboard',
  '/importacao/meu-dia': 'Meu Dia',
  '/importacao/executivo': 'Dashboard Executivo',
  '/importacao/processos': 'Processos',
  '/importacao/processos/novo': 'Novo Processo',
  '/importacao/pre-cons': 'Pré-Conferência',
  '/importacao/compras-pagamentos': 'Compras e Pagamentos Internacionais',
  '/importacao/cambios': 'Câmbios',
  '/importacao/lis': 'LIs / LPCOs',
  '/importacao/desembaraco': 'Desembaraço Aduaneiro',
  '/importacao/numerario': 'Numerário',
  '/importacao/follow-up': 'Follow-Up',
  '/importacao/assistente': 'Assistente Operacional',
  '/importacao/comunicacoes': 'Atendimentos',
  '/importacao/alertas': 'Central de Alertas',
  '/importacao/email-ingestion': 'Ingestão de E-mail',
  '/importacao/auditoria': 'Auditoria',
  '/importacao/configuracoes': 'Configurações',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.match(/\/processos\/.+\/editar/)) return 'Editar Processo';
  if (pathname.startsWith('/importacao/processos/')) return 'Detalhes do Processo';
  return 'Dashboard';
}

function resolveHeader(pathname: string, allNavItems: AppNavItem[]): AppHeaderInfo {
  const crumbs: { label: string; href?: string }[] = [];
  const current = allNavItems.find((i) => pathname.startsWith(i.to));
  if (current) {
    crumbs.push({ label: current.label, href: current.to });
  }
  if (pathname.includes('/novo')) {
    crumbs.push({ label: 'Novo' });
  } else if (pathname.match(/\/processos\/.+\/editar/)) {
    crumbs.push({ label: 'Editar' });
  } else if (pathname.match(/\/processos\/.+/) && !pathname.includes('/novo')) {
    crumbs.push({ label: 'Detalhes' });
  }
  return { title: getPageTitle(pathname), breadcrumbs: crumbs };
}

async function importacaoHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

export function ImportacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout
      moduleKey="importacao"
      moduleName="Importação"
      accent="primary"
      navSections={navSections}
      navAriaLabel="Menu principal"
      checkHealth={importacaoHealth}
      resolveHeader={resolveHeader}
      moduleSwitch={{ to: '/certificacoes', label: 'Ir para Certificações' }}
    >
      {children}
    </AppLayout>
  );
}
