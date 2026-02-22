import { useEffect, useState, useCallback } from 'react';
import {
  fetchCertSchedules,
  createCertSchedule,
  updateCertSchedule,
  deleteCertSchedule,
  runCertScheduleNow,
  fetchCertScheduleHistory,
} from '@/shared/lib/cert-api-client';
import { cronToHuman, formatDateTime } from '@/shared/lib/utils';
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Play,
  Loader2,
  Clock,
  History,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

interface Schedule {
  id: string;
  name: string;
  brand_filter: string | null;
  cron_expression: string;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  next_run: string | null;
}

interface HistoryEntry {
  id: string;
  schedule_id: string;
  run_date: string;
  status: string;
  summary: any;
  report_file: string | null;
}

const BRAND_OPTIONS = [
  { value: '', label: 'Todas as marcas' },
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

const FREQUENCY_PRESETS = [
  { value: 'daily', label: 'Diario (06:00)', cron: '0 6 * * *' },
  { value: 'weekly_mon', label: 'Semanal (Segunda)', cron: '0 6 * * 1' },
  { value: 'weekly_fri', label: 'Semanal (Sexta)', cron: '0 6 * * 5' },
  { value: 'monthly', label: 'Mensal (Dia 1)', cron: '0 6 1 * *' },
  { value: 'custom', label: 'Personalizado', cron: '' },
];

function buildCron(preset: string, hour: string, minute: string): string {
  if (preset === 'custom') return '';
  const p = FREQUENCY_PRESETS.find((f) => f.value === preset);
  if (!p) return '';
  const parts = p.cron.split(' ');
  parts[0] = minute || '0';
  parts[1] = hour || '6';
  return parts.join(' ');
}

function detectPreset(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return 'custom';
  const [, , day, month, dow] = parts;
  if (month !== '*') return 'custom';
  if (day === '1' && dow === '*') return 'monthly';
  if (day === '*' && dow === '1') return 'weekly_mon';
  if (day === '*' && dow === '5') return 'weekly_fri';
  if (day === '*' && dow === '*') return 'daily';
  return 'custom';
}

function parseCronTime(cron: string): { hour: string; minute: string } {
  const parts = cron.split(' ');
  if (parts.length === 5) {
    return { hour: parts[1], minute: parts[0] };
  }
  return { hour: '6', minute: '0' };
}

export default function CertAgendamentosPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, HistoryEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formPreset, setFormPreset] = useState('daily');
  const [formHour, setFormHour] = useState('6');
  const [formMinute, setFormMinute] = useState('0');
  const [formCustomCron, setFormCustomCron] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState('');

  const loadSchedules = useCallback(async () => {
    try {
      const data = await fetchCertSchedules();
      setSchedules(Array.isArray(data) ? data : []);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  function resetForm() {
    setFormName('');
    setFormBrand('');
    setFormPreset('daily');
    setFormHour('6');
    setFormMinute('0');
    setFormCustomCron('');
    setFormEnabled(true);
    setFormError('');
    setEditingId(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(schedule: Schedule) {
    setFormName(schedule.name);
    setFormBrand(schedule.brand_filter || '');
    const preset = detectPreset(schedule.cron_expression);
    setFormPreset(preset);
    if (preset === 'custom') {
      setFormCustomCron(schedule.cron_expression);
    }
    const { hour, minute } = parseCronTime(schedule.cron_expression);
    setFormHour(hour);
    setFormMinute(minute);
    setFormEnabled(schedule.enabled);
    setFormError('');
    setEditingId(schedule.id);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!formName.trim()) {
      setFormError('Nome e obrigatorio');
      return;
    }

    const cron =
      formPreset === 'custom'
        ? formCustomCron
        : buildCron(formPreset, formHour, formMinute);

    if (!cron.trim()) {
      setFormError('Expressao cron e obrigatoria');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateCertSchedule(editingId, {
          name: formName.trim(),
          cron,
          brand: formBrand || undefined,
          enabled: formEnabled,
        });
      } else {
        await createCertSchedule({
          name: formName.trim(),
          cron,
          brand: formBrand || undefined,
          enabled: formEnabled,
        });
      }
      setShowForm(false);
      resetForm();
      await loadSchedules();
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao salvar agendamento');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCertSchedule(id);
      setDeleteConfirm(null);
      await loadSchedules();
    } catch {
      // silently fail
    }
  }

  async function handleTrigger(id: string) {
    setTriggeringId(id);
    try {
      await runCertScheduleNow(id);
    } catch {
      // silently fail
    } finally {
      setTimeout(() => setTriggeringId(null), 2000);
    }
  }

  async function handleToggleEnabled(schedule: Schedule) {
    setTogglingId(schedule.id);
    try {
      await updateCertSchedule(schedule.id, { enabled: !schedule.enabled });
      await loadSchedules();
    } catch {
      // silently fail
    } finally {
      setTogglingId(null);
    }
  }

  async function toggleHistory(id: string) {
    if (expandedHistory === id) {
      setExpandedHistory(null);
      return;
    }
    setExpandedHistory(id);
    if (!historyData[id]) {
      setHistoryLoading(id);
      try {
        const data = await fetchCertScheduleHistory(id);
        setHistoryData((prev) => ({ ...prev, [id]: Array.isArray(data) ? data.slice(0, 5) : [] }));
      } catch {
        setHistoryData((prev) => ({ ...prev, [id]: [] }));
      } finally {
        setHistoryLoading(null);
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Agendamentos</h2>
          <p className="text-sm text-slate-500">Configure validacoes automaticas recorrentes</p>
        </div>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Agendamento
        </button>
      </div>

      {/* Schedule list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center py-16 text-slate-400">
          <CalendarClock className="w-10 h-10 mb-2" />
          <p className="text-sm">Nenhum agendamento configurado</p>
          <p className="text-xs mt-1">Crie um agendamento para validacoes automaticas</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden"
            >
              <div className="p-4 md:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">
                        {schedule.name}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          schedule.enabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {schedule.enabled ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {cronToHuman(schedule.cron_expression)}
                      </span>
                      {schedule.brand_filter && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {BRAND_OPTIONS.find((b) => b.value === schedule.brand_filter)?.label ||
                            schedule.brand_filter}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
                      {schedule.last_run && (
                        <span>Ultima execucao: {formatDateTime(schedule.last_run)}</span>
                      )}
                      {schedule.next_run && (
                        <span>Proxima execucao: {formatDateTime(schedule.next_run)}</span>
                      )}
                      {!schedule.last_run && !schedule.next_run && (
                        <span>Ainda nao executado</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleToggleEnabled(schedule)}
                      disabled={togglingId === schedule.id}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        schedule.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                      title={schedule.enabled ? 'Desativar' : 'Ativar'}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          schedule.enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>

                    <button
                      onClick={() => handleTrigger(schedule.id)}
                      disabled={triggeringId === schedule.id}
                      className="p-2 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      title="Executar agora"
                    >
                      {triggeringId === schedule.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      onClick={() => openEditForm(schedule)}
                      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setDeleteConfirm(schedule.id)}
                      className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => toggleHistory(schedule.id)}
                      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      title="Historico"
                    >
                      {expandedHistory === schedule.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <History className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* History section */}
              {expandedHistory === schedule.id && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">Ultimas execucoes</p>
                  {historyLoading === schedule.id ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                    </div>
                  ) : !historyData[schedule.id] || historyData[schedule.id].length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">Nenhuma execucao registrada</p>
                  ) : (
                    <div className="space-y-2">
                      {historyData[schedule.id].map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                entry.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
                              }`}
                            />
                            <span className="text-slate-600">
                              {formatDateTime(entry.run_date)}
                            </span>
                          </div>
                          {entry.summary && typeof entry.summary === 'object' && (
                            <div className="flex items-center gap-2 text-slate-500">
                              <span>{entry.summary.total || 0} produtos</span>
                              {entry.summary.ok > 0 && (
                                <span className="text-emerald-600">{entry.summary.ok} OK</span>
                              )}
                              {entry.summary.missing > 0 && (
                                <span className="text-red-600">{entry.summary.missing} ausentes</span>
                              )}
                              {entry.summary.inconsistent > 0 && (
                                <span className="text-amber-600">
                                  {entry.summary.inconsistent} inconsist.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Delete confirmation */}
              {deleteConfirm === schedule.id && (
                <div className="border-t border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-red-700">Excluir este agendamento?</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit dialog overlay */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { setShowForm(false); resetForm(); }}
          />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingId ? 'Editar Agendamento' : 'Novo Agendamento'}
              </h3>
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Validacao diaria Imaginarium"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Marca</label>
                <select
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {BRAND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequencia</label>
                <select
                  value={formPreset}
                  onChange={(e) => setFormPreset(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FREQUENCY_PRESETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {formPreset !== 'custom' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Hora</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={formHour}
                      onChange={(e) => setFormHour(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Minuto</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={formMinute}
                      onChange={(e) => setFormMinute(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {formPreset === 'custom' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Expressao Cron (min hora dia mes dia_semana)
                  </label>
                  <input
                    type="text"
                    value={formCustomCron}
                    onChange={(e) => setFormCustomCron(e.target.value)}
                    placeholder="0 8 * * 1-5"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Exemplo: 0 8 * * 1-5 = dias uteis as 08:00
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFormEnabled(!formEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    formEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      formEnabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <span className="text-sm text-slate-700">
                  {formEnabled ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              {formError && (
                <p className="text-xs text-red-600">{formError}</p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
