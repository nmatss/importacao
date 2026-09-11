import { useState, useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import {
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowLeftRight,
} from 'lucide-react';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { AssistantBubble } from '@/shared/components/AssistantBubble';

/**
 * Shell único dos módulos (auditoria 2026-07-17): ImportacaoLayout e
 * CertificacoesLayout eram ~73% idênticos linha a linha (193/707 divergiam) e
 * toda melhoria precisava ser feita duas vezes — e divergiam de fato (só a
 * importação tinha breadcrumb). Este componente carrega o shell; os módulos
 * viram wrappers finos com nav/accent/health próprios.
 *
 * Ganhos embutidos: collapse persistido em localStorage e switcher direto
 * entre módulos (antes só via Portal).
 */

export interface AppNavItem {
  to: string;
  label: string;
  icon: ElementType;
  exact?: boolean;
  adminOnly?: boolean;
}

export interface AppNavSection {
  label: string;
  items: AppNavItem[];
}

export interface AppHeaderInfo {
  title: string;
  breadcrumbs?: { label: string; href?: string }[];
}

export type AppAccent = 'primary' | 'emerald';

// Tailwind exige classes literais — mapa por accent, nunca interpolação.
const ACCENT = {
  primary: {
    navActive: 'bg-primary-600/20 text-white shadow-sm',
    iconActive: 'text-primary-400',
    dot: 'bg-primary-400',
    avatarHeader: 'from-primary-500 to-primary-600',
    userMini: 'bg-primary-500/20 text-primary-300',
    crumbHover: 'hover:text-primary-600 dark:hover:text-primary-400',
  },
  emerald: {
    navActive: 'bg-emerald-500/20 text-white shadow-sm',
    iconActive: 'text-emerald-400',
    dot: 'bg-emerald-400',
    avatarHeader: 'from-emerald-500 to-emerald-600',
    userMini: 'bg-emerald-500/20 text-emerald-300',
    crumbHover: 'hover:text-emerald-600 dark:hover:text-emerald-400',
  },
} as const satisfies Record<AppAccent, Record<string, string>>;

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function isDesktopViewport(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(min-width: 1024px)').matches;
}

export interface AppLayoutProps {
  children: ReactNode;
  /** Slug estável do módulo — chave do localStorage do collapse. */
  moduleKey: string;
  /** Subtítulo sob o logo (ex.: "Importação"). */
  moduleName: string;
  accent: AppAccent;
  navSections: AppNavSection[];
  navAriaLabel: string;
  /** Health-check do backend do módulo (indicador no logo). */
  checkHealth: () => Promise<boolean>;
  /** Resolve título + breadcrumbs do header a partir do pathname. */
  resolveHeader: (pathname: string, allNavItems: AppNavItem[]) => AppHeaderInfo;
  /** Link direto para o outro módulo (switcher na base da sidebar). */
  moduleSwitch?: { to: string; label: string };
}

export function AppLayout({
  children,
  moduleKey,
  moduleName,
  accent,
  navSections,
  navAriaLabel,
  checkHealth,
  resolveHeader,
  moduleSwitch,
}: AppLayoutProps) {
  const collapseKey = `sidebar_collapsed_${moduleKey}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapseKey) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopViewport, setDesktopViewport] = useState(isDesktopViewport);
  const [apiOnline, setApiOnline] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const { user, logout } = useAuth();
  const location = useLocation();
  const a = ACCENT[accent];

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      checkHealth()
        .then((ok) => !cancelled && setApiOnline(ok))
        .catch(() => !cancelled && setApiOnline(false));
    run();
    const interval = setInterval(run, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // checkHealth é estável por módulo (função top-level do wrapper).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent) => setDesktopViewport(event.matches);
    setDesktopViewport(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (!desktopViewport && !mobileOpen) sidebar.setAttribute('inert', '');
    else sidebar.removeAttribute('inert');
  }, [desktopViewport, mobileOpen]);

  useEffect(() => {
    if (desktopViewport || !mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const mobileMenuButton = mobileMenuButtonRef.current;
    document.body.style.overflow = 'hidden';
    const animationFrame = window.requestAnimationFrame(() =>
      mobileCloseButtonRef.current?.focus(),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => window.getComputedStyle(element).visibility !== 'hidden');
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      mobileMenuButton?.focus();
    };
  }, [desktopViewport, mobileOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(collapseKey, prev ? '0' : '1');
      } catch {
        // localStorage indisponível — segue sem persistir.
      }
      return !prev;
    });
  };

  const allNavItems = navSections.flatMap((s) => s.items);
  const { title: pageTitle, breadcrumbs = [] } = resolveHeader(location.pathname, allNavItems);
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || user?.role === 'admin'),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-page">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-sidebar-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — Dark Enterprise */}
      <aside
        ref={sidebarRef}
        id={`${moduleKey}-navigation`}
        aria-hidden={!desktopViewport && !mobileOpen}
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
            <span className="sr-only">{apiOnline ? 'API online' : 'API indisponível'}</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-white tracking-tight">Uni.co</p>
              <p className="truncate text-[11px] text-sidebar-200/50 font-medium">{moduleName}</p>
            </div>
          )}
          <button
            ref={mobileCloseButtonRef}
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-1.5 text-sidebar-200/70 hover:bg-white/5 hover:text-white lg:hidden transition-colors"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav aria-label={navAriaLabel} className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {visibleNavSections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-200/70">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    aria-label={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                        isActive
                          ? a.navActive
                          : 'text-sidebar-200/80 hover:bg-white/5 hover:text-white',
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
                              ? a.iconActive
                              : 'text-sidebar-200/70 group-hover:text-sidebar-200/70',
                          )}
                        />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {isActive && !collapsed && (
                          <div className={cn('ml-auto h-1.5 w-1.5 rounded-full', a.dot)} />
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

          <div className="px-3 py-2 space-y-0.5">
            {moduleSwitch && (
              <Link
                to={moduleSwitch.to}
                aria-label={collapsed ? moduleSwitch.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-200/70 hover:bg-white/5 hover:text-white transition-all duration-150',
                  collapsed && 'justify-center px-0',
                )}
              >
                <ArrowLeftRight className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span>{moduleSwitch.label}</span>}
              </Link>
            )}
            <Link
              to="/portal"
              aria-label={collapsed ? 'Voltar ao Portal' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-200/70 hover:bg-white/5 hover:text-white transition-all duration-150',
                collapsed && 'justify-center px-0',
              )}
            >
              <ArrowLeft className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span>Voltar ao Portal</span>}
            </Link>
          </div>

          {/* User mini + collapse */}
          <div className="px-3 pb-3">
            {!collapsed && user && (
              <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2.5 mb-2">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold',
                    a.userMini,
                  )}
                >
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-white/80">{user.name}</p>
                  <p className="truncate text-[10px] text-sidebar-200/70">{user.role}</p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden lg:flex h-8 w-full items-center justify-center rounded-lg text-sidebar-200/70 hover:bg-white/5 hover:text-white/60 transition-all duration-150"
              aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
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
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 bg-white dark:bg-slate-900 dark:border-slate-700/60 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 lg:hidden transition-colors"
              aria-label="Abrir menu"
              aria-expanded={mobileOpen}
              aria-controls={`${moduleKey}-navigation`}
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 items-center gap-2">
              {breadcrumbs.length > 1 && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                  {breadcrumbs.slice(0, -1).map((crumb, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {crumb.href ? (
                        <Link to={crumb.href} className={cn('transition-colors', a.crumbHover)}>
                          {crumb.label}
                        </Link>
                      ) : (
                        crumb.label
                      )}
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  ))}
                </div>
              )}
              <h1 className="truncate text-base font-semibold text-slate-800 dark:text-slate-100 tracking-tight">
                {pageTitle}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {user && (
              <>
                <div className="mr-1 hidden max-w-[180px] text-right sm:block lg:max-w-[240px]">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200 leading-tight">
                    {user.name}
                  </p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {user.role}
                  </p>
                </div>
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white text-[11px] font-bold shadow-sm',
                    a.avatarHeader,
                  )}
                >
                  {getInitials(user.name)}
                </div>
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 hidden sm:block mx-1" />
                <button
                  type="button"
                  onClick={logout}
                  className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-400 transition-all duration-150"
                  title="Sair"
                  aria-label="Sair do sistema"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs font-medium">Sair</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main
          id="main"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-auto p-4 pb-24 outline-none lg:p-6 lg:pb-24"
        >
          {children}
        </main>
      </div>
      <AssistantBubble accent={accent} />
    </div>
  );
}
