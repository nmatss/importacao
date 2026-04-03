import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/shared/hooks/useAuth';
import { Ship, FileCheck, BarChart3, Shield, ArrowRight } from 'lucide-react';

const features = [
  { icon: Ship, label: 'Gestão de Importações', desc: 'Controle completo dos processos' },
  { icon: FileCheck, label: 'Validação de Documentos', desc: 'IA para conferência automática' },
  { icon: BarChart3, label: 'Dashboards em Tempo Real', desc: 'Métricas e indicadores' },
  { icon: Shield, label: 'Certificações INMETRO', desc: 'Monitoramento e-commerce' },
];

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Left panel — dark branding */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-sidebar-950 animate-fade-in">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary-900/40 via-sidebar-950 to-sidebar-950" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        {/* Glow accent */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 right-0 w-80 h-80 bg-primary-500/10 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Top — logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
              <img src="/logo-unico.png" alt="Uni.co" className="h-8 w-8 rounded-lg" />
            </div>
            <div>
              <span className="text-white text-base font-bold tracking-tight">Uni.co</span>
              <p className="text-white/30 text-[10px] font-medium">Sistema Integrado</p>
            </div>
          </div>

          {/* Center — hero */}
          <div className="max-w-lg">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-500/10 border border-primary-500/20 px-3 py-1 mb-6">
              <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse" />
              <span className="text-xs font-medium text-primary-300">Plataforma v1.0</span>
            </div>

            <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.08] tracking-tight">
              Sistema Integrado
              <br />
              <span className="bg-gradient-to-r from-primary-300 to-primary-500 bg-clip-text text-transparent">
                de Importação
              </span>
            </h1>
            <p className="text-sidebar-200/50 text-base mt-4 leading-relaxed max-w-md">
              Plataforma completa para gestão de processos de importação, validação documental e
              certificações.
            </p>

            <div className="grid grid-cols-2 gap-3 mt-10">
              {features.map((f) => (
                <div
                  key={f.label}
                  className="group flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3.5 hover:bg-white/[0.06] transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500/10">
                    <f.icon className="h-4 w-4 text-primary-400" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-white/80">{f.label}</span>
                    <p className="text-[11px] text-white/30 mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom — footer */}
          <p className="text-sidebar-200/20 text-xs">
            &copy; {new Date().getFullYear()} Grupo Unico. Todos os direitos reservados.
          </p>
        </div>
      </div>

      {/* Right panel — login */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile logo */}
        <div className="flex items-center gap-3 p-6 lg:hidden">
          <img src="/logo-unico.png" alt="Uni.co" className="h-9 w-9 rounded-xl" />
          <span className="text-slate-800 font-bold">Uni.co</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* Welcome text */}
            <div className="text-center mb-8">
              <div className="lg:hidden inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600 mb-5">
                <Ship className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Bem-vindo de volta
              </h2>
              <p className="text-slate-500 mt-2 text-sm">
                Faça login com sua conta Google corporativa
              </p>
            </div>

            {/* Login card */}
            <div
              className="bg-white rounded-2xl border border-slate-200/60 p-8 shadow-sm shadow-slate-900/[0.03] animate-fade-in-up"
              style={{ animationDelay: '100ms' }}
            >
              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-xl bg-danger-50 border border-danger-100 px-4 py-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-danger-500 shrink-0" />
                  <p className="text-sm text-danger-600">{error}</p>
                </div>
              )}

              <div className="flex flex-col items-center">
                {loading ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="h-10 w-10 rounded-full border-[3px] border-slate-200 border-t-primary-600 animate-spin" />
                    <p className="text-sm text-slate-500">Autenticando...</p>
                  </div>
                ) : (
                  <GoogleLogin
                    onSuccess={async (response) => {
                      if (!response.credential) return;
                      setError(null);
                      setLoading(true);
                      try {
                        await loginWithGoogle(response.credential);
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : 'Erro ao fazer login com Google',
                        );
                        setLoading(false);
                      }
                    }}
                    onError={() => {
                      setError('Erro ao conectar com Google');
                    }}
                    size="large"
                    width="320"
                    text="signin_with"
                    shape="rectangular"
                    logo_alignment="left"
                  />
                )}
              </div>

              <div className="mt-6 flex items-center gap-2 justify-center">
                <div className="h-px flex-1 bg-slate-100" />
                <span className="text-[11px] text-slate-400 px-2 font-medium">@grupounico.com</span>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
            </div>

            {/* Help text */}
            <p className="text-center text-xs text-slate-400 mt-6 leading-relaxed">
              Acesso restrito a colaboradores do Grupo Unico.
              <br />
              Problemas? Contate o administrador.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
