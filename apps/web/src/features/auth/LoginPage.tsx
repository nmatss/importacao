import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/shared/hooks/useAuth';

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);

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

          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={async (response) => {
                if (!response.credential) return;
                setError(null);
                try {
                  await loginWithGoogle(response.credential);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Erro ao fazer login com Google');
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
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Acesso restrito a contas @grupounico.com
          </p>
        </div>
      </div>
    </div>
  );
}
