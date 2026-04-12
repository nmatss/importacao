import { useState, useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  PlayCircle,
  Package,
  FileBarChart,
  CalendarClock,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ArrowLeft,
  Search,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { checkCertApiHealth } from '@/shared/lib/cert-api-client';
import { ThemeToggle } from '@/shared/components/ThemeToggle';

const navSections = [
  {
    label: 'Principal',
    items: [
      { to: '/certificacoes', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/certificacoes/validacao', label: 'Validação', icon: PlayCircle },
      { to: '/certificacoes/produtos', label: 'Produtos', icon: Package },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { to: '/certificacoes/relatorios', label: 'Relatórios', icon: FileBarChart },
      { to: '/certificacoes/agendamentos', label: 'Agendamentos', icon: CalendarClock },
      { to: '/certificacoes/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

const allNavItems = navSections.flatMap((s) => s.items);

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function CertificacoesLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    checkCertApiHealth().then((h) => setApiOnline(h.connected));
    const interval = setInterval(() => {
      checkCertApiHealth().then((h) => setApiOnline(h.connected));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const currentNav = allNavItems.find((item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );
  const pageTitle = currentNav?.label || 'Certificações';

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-sidebar-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — Dark Enterprise (Emerald accent) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-800/50 transition-all duration-300 ease-in-out lg:relative',
          'bg-gradient-to-b from-sidebar-900 via-sidebar-900 to-sidebar-950',
          collapsed ? 'w-[72px]' : 'w-[264px]',
          mobileOpen
            ? 'translate-x-0 shadow-2xl shadow-black/40'
            : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Logo area */}
        <div
          className={cn(
            'flex h-16 items-center gap-3 px-5 shrink-0',
            collapsed && 'justify-center px-0',
          )}
        >
          <div className="relative flex-shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
              <img src="/logo-unico.png" alt="Uni.co" className="h-7 w-7 rounded-lg object-cover" />
            </div>
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-sidebar-900 transition-colors',
                apiOnline ? 'bg-emerald-400' : 'bg-slate-500',
              )}
            />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-white tracking-tight">Uni.co</p>
              <p className="truncate text-[11px] text-sidebar-200/50 font-medium">Certificações</p>
            </div>
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-1.5 text-sidebar-200/40 hover:bg-white/5 hover:text-white lg:hidden transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="mx-4 mb-1 mt-1">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/5 px-3 py-2 text-sidebar-200/40">
              <Search className="h-3.5 w-3.5" />
              <span className="text-xs">Buscar...</span>
              <kbd className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-200/30">
                ⌘K
              </kbd>
            </div>
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          {navSections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-200/30">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                        isActive
                          ? 'bg-emerald-500/20 text-white shadow-sm'
                          : 'text-sidebar-200/60 hover:bg-white/5 hover:text-white',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0 transition-colors duration-150',
                            isActive
                              ? 'text-emerald-400'
                              : 'text-sidebar-200/40 group-hover:text-sidebar-200/70',
                          )}
                        />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {isActive && !collapsed && (
                          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="shrink-0">
          <div className="mx-4 border-t border-white/5" />

          <div className="px-3 py-2">
            <Link
              to="/portal"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-200/40 hover:bg-white/5 hover:text-white transition-all duration-150',
                collapsed && 'justify-center px-0',
              )}
            >
              <ArrowLeft className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span>Voltar ao Portal</span>}
            </Link>
          </div>

          <div className="px-3 pb-3">
            {!collapsed && user && (
              <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2.5 mb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-white/80">{user.name}</p>
                  <p className="truncate text-[10px] text-sidebar-200/30">{user.role}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                'hidden lg:flex h-8 w-full items-center justify-center rounded-lg text-sidebar-200/30 hover:bg-white/5 hover:text-white/60 transition-all duration-150',
              )}
            >
              <ChevronLeft
                className={cn(
                  'h-4 w-4 transition-transform duration-300',
                  collapsed && 'rotate-180',
                )}
              />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/60 bg-white dark:bg-slate-900 dark:border-slate-700/60 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 lg:hidden transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 tracking-tight">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user && (
              <>
                <div className="hidden sm:block text-right mr-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-tight">
                    {user.name}
                  </p>
                  <p className="text-[11px] text-slate-400">{user.role}</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-[11px] font-bold shadow-sm">
                  {getInitials(user.name)}
                </div>
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 hidden sm:block mx-1" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-400 transition-all duration-150"
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs font-medium">Sair</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
