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
} from 'lucide-react';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { checkCertApiHealth } from '@/shared/lib/cert-api-client';

const navItems = [
  { to: '/certificacoes', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/certificacoes/validacao', label: 'Validacao', icon: PlayCircle },
  { to: '/certificacoes/produtos', label: 'Produtos', icon: Package },
  { to: '/certificacoes/relatorios', label: 'Relatorios', icon: FileBarChart },
  { to: '/certificacoes/agendamentos', label: 'Agendamentos', icon: CalendarClock },
  { to: '/certificacoes/configuracoes', label: 'Configuracoes', icon: Settings },
];

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

  const currentNav = navItems.find(
    (item) =>
      item.exact
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to),
  );
  const pageTitle = currentNav?.label || 'Certificacoes';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-slate-200/80 transition-all duration-300 ease-in-out lg:relative',
          collapsed ? 'w-[68px]' : 'w-64',
          mobileOpen ? 'translate-x-0 shadow-2xl shadow-slate-900/20' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Logo area */}
        <div className={cn(
          'flex h-16 items-center gap-3 px-4 shrink-0',
          collapsed ? 'justify-center' : '',
        )}>
          <div className="relative flex-shrink-0">
            <img
              src="/logo-unico.png"
              alt="Uni.co"
              className="h-9 w-9 rounded-xl object-cover"
            />
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white transition-colors',
                apiOnline ? 'bg-emerald-500' : 'bg-slate-300',
              )}
            />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-slate-900 tracking-tight">Uni.co</p>
              <p className="truncate text-[11px] text-slate-400 font-medium">Certificacoes E-commerce</p>
            </div>
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-1.5 hover:bg-slate-100 lg:hidden transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Separator */}
        <div className="mx-3 border-t border-slate-100" />

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 font-semibold shadow-sm shadow-emerald-100/50'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-colors duration-200',
                    isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600',
                  )} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="shrink-0">
          {/* Separator */}
          <div className="mx-3 border-t border-slate-100" />

          {/* Back to portal */}
          <div className="px-3 py-2">
            <Link
              to="/portal"
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all duration-200',
                collapsed && 'justify-center px-0',
              )}
            >
              <ArrowLeft className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span>Voltar ao Portal</span>}
            </Link>
          </div>

          {/* Version */}
          {!collapsed && (
            <div className="px-6 pb-1">
              <p className="text-[10px] text-slate-300 font-medium">v1.0.0</p>
            </div>
          )}

          {/* Collapse toggle */}
          <div className="hidden lg:block px-3 pb-3">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                'flex h-9 w-full items-center justify-center rounded-xl text-slate-300 hover:bg-slate-50 hover:text-slate-500 transition-all duration-200',
              )}
            >
              <ChevronLeft className={cn(
                'h-4 w-4 transition-transform duration-300',
                collapsed && 'rotate-180',
              )} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 backdrop-blur-xl px-4 lg:px-6 shadow-sm shadow-slate-100/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-xl p-2 hover:bg-slate-100 lg:hidden transition-colors"
            >
              <Menu className="h-5 w-5 text-slate-500" />
            </button>
            <h1 className="text-lg font-semibold text-slate-800 tracking-tight">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <>
                <div className="hidden sm:block text-right mr-1">
                  <p className="text-sm font-semibold text-slate-700 leading-tight">{user.name}</p>
                  <p className="text-[11px] text-slate-400 font-medium">{user.role}</p>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-bold shadow-sm shadow-emerald-200/50">
                  {getInitials(user.name)}
                </div>
                <div className="w-px h-6 bg-slate-200 hidden sm:block" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline text-[13px] font-medium">Sair</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-slate-50/80 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
