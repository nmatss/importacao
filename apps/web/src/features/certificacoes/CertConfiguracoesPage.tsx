import { useEffect, useState } from 'react';
import { fetchCertStats, checkCertApiHealth } from '@/shared/lib/cert-api-client';
import { cn } from '@/shared/lib/utils';
import { CheckCircle2, XCircle, Database, Globe, Cpu, Zap, Loader2, Radio, Clock } from 'lucide-react';

export default function CertConfiguracoesPage() {
  const [stats, setStats] = useState<any>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; latencyMs: number } | null>(null);

  useEffect(() => {
    async function load() {
      const health = await checkCertApiHealth();
      setApiHealthy(health.connected);
      if (health.connected) {
        try {
          const data = await fetchCertStats();
          setStats(data);
        } catch {
          setStats(null);
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    const result = await checkCertApiHealth();
    setTestResult(result);
    setApiHealthy(result.connected);
    if (result.connected) {
      try {
        const data = await fetchCertStats();
        setStats(data);
      } catch {
        // stats fetch failed but API is up
      }
    }
    setTesting(false);
  }

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Status do Sistema</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  testing
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100',
                )}
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Radio className="w-3.5 h-3.5" />
                )}
                Testar Conexao
              </button>
              {testResult && (
                <span
                  className={cn(
                    'text-[10px] font-medium px-2 py-1 rounded-full',
                    testResult.connected
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700',
                  )}
                >
                  {testResult.connected
                    ? `OK - ${testResult.latencyMs}ms`
                    : `Falha - ${testResult.latencyMs}ms`}
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">API Backend</p>
                    <p className="text-xs text-slate-500">FastAPI - Porta 8000</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {apiHealthy ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm text-emerald-600">Online</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600">Offline</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Google Sheets</p>
                    <p className="text-xs text-slate-500">Fonte de dados dos produtos</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {apiHealthy && stats ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm text-emerald-600">Conectado</span>
                    </>
                  ) : apiHealthy && !stats ? (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600">Erro ao ler dados</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-500">Desconhecido</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Sites Monitorados</p>
                    <p className="text-xs text-slate-500">puket.com.br, loja.imaginarium.com.br</p>
                  </div>
                </div>
                <span className="text-sm text-slate-600">2 sites</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How it Works */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="p-4">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-blue-600" />
            Verificacao em Tempo Real
          </h3>
          <div className="space-y-4 text-sm text-slate-600">
            <p>
              O sistema consulta os e-commerces Puket e Imaginarium em{' '}
              <span className="font-medium text-slate-900">tempo real</span> usando
              a API publica VTEX. Nenhum dado de produto e armazenado localmente.
            </p>
            <hr className="border-slate-200" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded bg-blue-50 text-blue-600 mt-0.5">
                  <Database className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="font-medium text-slate-900 text-xs">1. Leitura da Planilha</p>
                  <p className="text-xs mt-0.5">Produtos e certificacoes esperadas sao carregados do Google Sheets</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded bg-blue-50 text-blue-600 mt-0.5">
                  <Globe className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="font-medium text-slate-900 text-xs">2. Consulta VTEX</p>
                  <p className="text-xs mt-0.5">Cada SKU e buscado na API VTEX para obter a descricao do produto</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded bg-blue-50 text-blue-600 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="font-medium text-slate-900 text-xs">3. Comparacao</p>
                  <p className="text-xs mt-0.5">O texto de certificacao encontrado e comparado com o valor esperado</p>
                </div>
              </div>
            </div>
            <hr className="border-slate-200" />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Delay entre requests: 1.5s por produto para evitar rate limiting da API VTEX</span>
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Informacoes</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Total de Produtos</p>
              <p className="font-medium text-slate-900">{stats?.total_products || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500">Planilha</p>
              <p className="font-medium text-slate-900">STATUS CERTIFICACAO</p>
            </div>
            <div>
              <p className="text-slate-500">Marcas</p>
              <p className="font-medium text-slate-900">Imaginarium, Puket, Puket Escolares</p>
            </div>
            <div>
              <p className="text-slate-500">Delay entre Requests</p>
              <p className="font-medium text-slate-900">1.5s</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
