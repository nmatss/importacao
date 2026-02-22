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
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - white theme */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:relative',
          collapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Logo area */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
          <div className="relative flex-shrink-0">
            <img
              src="/logo-unico.png"
              alt="Uni.co"
              className="h-8 w-8 rounded-full"
            />
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white',
                apiOnline ? 'bg-emerald-500' : 'bg-slate-400',
              )}
            />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-slate-900">Uni.co</p>
              <p className="truncate text-[10px] text-slate-500">Certificacoes E-commerce</p>
            </div>
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded p-1 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100',
                  collapsed && 'justify-center px-2',
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Back to portal + collapse */}
        <div className="border-t border-slate-200">
          <div className="p-3">
            <Link
              to="/portal"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors',
                collapsed && 'justify-center px-2',
              )}
            >
              <ArrowLeft className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Voltar ao Portal</span>}
            </Link>
          </div>
          {!collapsed && (
            <div className="px-4 py-2">
              <p className="text-[10px] text-slate-400">v1.0.0</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-10 w-full items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded p-1 hover:bg-gray-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {user.role}
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-gray-50 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
