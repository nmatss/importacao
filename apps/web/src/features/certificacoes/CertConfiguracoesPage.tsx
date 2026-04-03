import { useEffect, useState } from 'react';
import { fetchCertStats, checkCertApiHealth } from '@/shared/lib/cert-api-client';
import { cn } from '@/shared/lib/utils';
import {
  CheckCircle2,
  XCircle,
  Database,
  Globe,
  Cpu,
  Zap,
  Loader2,
  Radio,
  Clock,
  Info,
  ArrowRight,
} from 'lucide-react';

export default function CertConfiguracoesPage() {
  const [stats, setStats] = useState<any>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; latencyMs: number } | null>(
    null,
  );

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
    <div className="space-y-8">
      {/* Connection Status */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Status do Sistema</h3>
                <p className="text-xs text-slate-500">Monitoramento dos serviços</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200',
                  testing
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-sm hover:shadow-md hover:shadow-sm',
                )}
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Radio className="w-3.5 h-3.5" />
                )}
                Testar Conexão
              </button>
              {testResult && (
                <span
                  className={cn(
                    'text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5',
                    testResult.connected
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                      : 'bg-danger-50 text-danger-700 border border-danger-200/60',
                  )}
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      testResult.connected ? 'bg-emerald-500' : 'bg-danger-500',
                    )}
                  />
                  {testResult.connected
                    ? `Sucesso - ${testResult.latencyMs}ms`
                    : `Falha - ${testResult.latencyMs}ms`}
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {/* API Backend */}
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-slate-50/80 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Cpu className="w-[18px] h-[18px]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">API Backend</p>
                    <p className="text-xs text-slate-500">FastAPI - Porta 8000</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {apiHealthy ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-3 py-1.5 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger-700 bg-danger-50 border border-danger-200/60 px-3 py-1.5 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-danger-500" />
                      Offline
                    </span>
                  )}
                </div>
              </div>

              {/* Google Sheets */}
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-slate-50/80 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Database className="w-[18px] h-[18px]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">Google Sheets</p>
                    <p className="text-xs text-slate-500">Fonte de dados dos produtos</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {apiHealthy && stats ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-3 py-1.5 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Conectado
                    </span>
                  ) : apiHealthy && !stats ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger-700 bg-danger-50 border border-danger-200/60 px-3 py-1.5 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-danger-500" />
                      Erro ao ler dados
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      Desconhecido
                    </span>
                  )}
                </div>
              </div>

              {/* Sites Monitorados */}
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-slate-50/80 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Globe className="w-[18px] h-[18px]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">Sites Monitorados</p>
                    <p className="text-xs text-slate-500">puket.com.br, loja.imaginarium.com.br</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
                  2 sites
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How it Works */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Verificação em Tempo Real</h3>
              <p className="text-xs text-slate-500">Como funciona a validação</p>
            </div>
          </div>

          <div className="space-y-6 text-sm text-slate-600">
            <div className="rounded-xl bg-emerald-50/50 border border-emerald-100 p-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                O sistema consulta os e-commerces Puket e Imaginarium em{' '}
                <span className="font-semibold text-emerald-700">tempo real</span> usando a API
                pública VTEX. Nenhum dado de produto é armazenado localmente.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="relative flex flex-col gap-3 rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-xs font-bold shadow-sm">
                    1
                  </div>
                  <p className="font-semibold text-slate-800 text-sm">Leitura da Planilha</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed pl-11">
                  Produtos e certificações esperadas são carregados do Google Sheets
                </p>
                <ArrowRight className="hidden sm:block absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 z-10" />
              </div>

              <div className="relative flex flex-col gap-3 rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-xs font-bold shadow-sm">
                    2
                  </div>
                  <p className="font-semibold text-slate-800 text-sm">Consulta VTEX</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed pl-11">
                  Cada SKU é buscado na API VTEX para obter a descrição do produto
                </p>
                <ArrowRight className="hidden sm:block absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 z-10" />
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-xs font-bold shadow-sm">
                    3
                  </div>
                  <p className="font-semibold text-slate-800 text-sm">Comparação</p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed pl-11">
                  O texto de certificação encontrado é comparado com o valor esperado
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              <span>
                Intervalo entre requisições: 1.5s por produto para evitar bloqueio da API VTEX
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-slate-200/60 shadow-sm bg-white">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Informações</h3>
              <p className="text-xs text-slate-500">Dados de configuração</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-4">
              <p className="text-xs text-slate-500 mb-1">Total de Produtos</p>
              <p className="text-lg font-bold text-slate-900">{stats?.total_products || '-'}</p>
            </div>
            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-4">
              <p className="text-xs text-slate-500 mb-1">Planilha</p>
              <p className="text-lg font-bold text-slate-900">STATUS CERTIFICAÇÃO</p>
            </div>
            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-4">
              <p className="text-xs text-slate-500 mb-1">Marcas</p>
              <p className="text-lg font-bold text-slate-900">
                Imaginarium, Puket, Puket Escolares
              </p>
            </div>
            <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-4">
              <p className="text-xs text-slate-500 mb-1">Intervalo entre Requisições</p>
              <p className="text-lg font-bold text-slate-900">1.5s</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
