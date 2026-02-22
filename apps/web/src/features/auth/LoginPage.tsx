import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/shared/hooks/useAuth';

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="w-full max-w-md p-8">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4">
              <img
                src="/logo-unico.png"
                alt="Uni.co"
                className="w-20 h-20 rounded-full"
              />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Sistema Integrado Uni.co
            </h1>
            <p className="text-slate-500 mt-2">
              Portal de Importacao e Certificacao
            </p>
            <p className="text-xs text-slate-400 mt-1">
              INMETRO / ANATEL
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 text-center">
              {error}
            </div>
          )}

          <div className="flex flex-col items-center gap-3">
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Autenticando...
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
                width="350"
                text="signin_with"
                shape="rectangular"
                logo_alignment="left"
              />
            )}
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Acesso restrito a contas @grupounico.com
          </p>
        </div>
      </div>
    </div>
  );
}
