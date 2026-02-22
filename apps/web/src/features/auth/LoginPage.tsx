import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/shared/hooks/useAuth';
import { Ship, FileCheck, BarChart3, Shield } from 'lucide-react';

const features = [
  { icon: Ship, label: 'Gestao de Importacoes' },
  { icon: FileCheck, label: 'Validacao de Documentos' },
  { icon: BarChart3, label: 'Dashboards em Tempo Real' },
  { icon: Shield, label: 'Certificacoes INMETRO / ANATEL' },
];

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-blue-900">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 -left-10 w-72 h-72 rounded-full border border-white/30" />
          <div className="absolute top-40 left-40 w-96 h-96 rounded-full border border-white/20" />
          <div className="absolute -bottom-20 left-20 w-80 h-80 rounded-full border border-white/25" />
          <div className="absolute top-10 right-20 w-64 h-64 rounded-full border border-white/15" />
          <div className="absolute bottom-40 right-10 w-48 h-48 rounded-full border border-white/20" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Top - logo */}
          <div className="flex items-center gap-3">
            <img src="/logo-unico.png" alt="Uni.co" className="h-10 w-10 rounded-full bg-white p-0.5" />
            <span className="text-white/90 text-lg font-semibold tracking-wide">Uni.co</span>
          </div>

          {/* Center - hero text */}
          <div className="max-w-lg">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight">
              Sistema Integrado de Importacao
            </h1>
            <p className="text-blue-100 text-lg mt-4 leading-relaxed">
              Plataforma completa para gestao de processos de importacao, validacao documental e certificacoes.
            </p>

            <div className="grid grid-cols-2 gap-4 mt-10">
              {features.map((f) => (
                <div key={f.label} className="flex items-center gap-3 rounded-xl bg-white/10 backdrop-blur-sm px-4 py-3">
                  <f.icon className="h-5 w-5 text-blue-200 shrink-0" />
                  <span className="text-sm text-white/90 font-medium">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom - footer */}
          <p className="text-blue-200/60 text-xs">
            &copy; {new Date().getFullYear()} Grupo Unico. Todos os direitos reservados.
          </p>
        </div>
      </div>

      {/* Right panel - login */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {/* Mobile logo */}
        <div className="flex items-center gap-3 p-6 lg:hidden">
          <img src="/logo-unico.png" alt="Uni.co" className="h-9 w-9 rounded-full" />
          <span className="text-slate-800 font-semibold">Uni.co</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* Welcome text */}
            <div className="text-center mb-8">
              <div className="lg:hidden inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-5">
                <Ship className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">
                Bem-vindo
              </h2>
              <p className="text-slate-500 mt-2 text-sm">
                Faca login com sua conta Google corporativa
              </p>
            </div>

            {/* Login card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-8">
              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-red-400 shrink-0" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="flex flex-col items-center">
                {loading ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="h-10 w-10 rounded-full border-[3px] border-slate-200 border-t-blue-600 animate-spin" />
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
                        setError(err instanceof Error ? err.message : 'Erro ao fazer login com Google');
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
                <span className="text-xs text-slate-400 px-2">@grupounico.com</span>
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
