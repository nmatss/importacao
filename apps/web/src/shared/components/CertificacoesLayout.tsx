import {
  LayoutDashboard,
  PlayCircle,
  Package,
  FilePlus2,
  FileBarChart,
  CalendarClock,
  Settings,
} from 'lucide-react';
import { checkCertApiHealth } from '@/shared/lib/cert-api-client';
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
      { to: '/certificacoes', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/certificacoes/validacao', label: 'Validação', icon: PlayCircle },
      { to: '/certificacoes/produtos', label: 'Produtos', icon: Package },
      { to: '/certificacoes/cadastro', label: 'Cadastrar Certificado', icon: FilePlus2 },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { to: '/certificacoes/relatorios', label: 'Relatórios', icon: FileBarChart },
      {
        to: '/certificacoes/agendamentos',
        label: 'Agendamentos',
        icon: CalendarClock,
        adminOnly: true,
      },
      {
        to: '/certificacoes/configuracoes',
        label: 'Configurações',
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
];

function resolveHeader(rawPathname: string, allNavItems: AppNavItem[]): AppHeaderInfo {
  // Normaliza trailing slash: '/certificacoes/produtos/' é a LISTA, não detalhe.
  const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, '') : rawPathname;
  const currentNav = allNavItems.find((item) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to),
  );
  const base = currentNav?.label || 'Certificações';
  // Detalhe (/produtos/:sku, /relatorios/:id): breadcrumb com o pai clicável —
  // antes o header mostrava só o título genérico da seção.
  if (currentNav && pathname !== currentNav.to && !currentNav.exact) {
    return {
      title: 'Detalhes',
      breadcrumbs: [{ label: base, href: currentNav.to }, { label: 'Detalhes' }],
    };
  }
  return { title: base };
}

async function certHealth(): Promise<boolean> {
  const h = await checkCertApiHealth();
  return h.connected;
}

export function CertificacoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout
      moduleKey="certificacoes"
      moduleName="Certificações"
      accent="emerald"
      navSections={navSections}
      navAriaLabel="Menu principal de certificações"
      checkHealth={certHealth}
      resolveHeader={resolveHeader}
      moduleSwitch={{ to: '/importacao/dashboard', label: 'Ir para Importação' }}
    >
      {children}
    </AppLayout>
  );
}
