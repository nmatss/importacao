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
  Power,
  Zap,
  Tag,
} from 'lucide-react';

import type { CertSchedule as Schedule, CertScheduleHistoryEntry as HistoryEntry } from '@/shared/lib/cert-api-client';

const BRAND_OPTIONS = [
  { value: '', label: 'Todas as marcas' },
  { value: 'imaginarium', label: 'Imaginarium' },
  { value: 'puket', label: 'Puket' },
  { value: 'puket_escolares', label: 'Puket Escolares' },
];

const FREQUENCY_PRESETS = [
  { value: 'daily', label: 'Diário (06:00)', cron: '0 6 * * *' },
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
      setFormError('Nome é obrigatório');
      return;
    }

    const cron =
      formPreset === 'custom'
        ? formCustomCron
        : buildCron(formPreset, formHour, formMinute);

    if (!cron.trim()) {
      setFormError('Expressão cron é obrigatória');
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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/25">
            <CalendarClock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Agendamentos</h1>
            <p className="text-sm text-slate-500">Configure validações automáticas recorrentes</p>
          </div>
        </div>
        <button
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold shadow-sm hover:shadow-md hover:from-emerald-700 hover:to-emerald-800 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Agendamento
        </button>
      </div>

      {/* Schedule list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
          <p className="text-sm text-slate-400 mt-3">Carregando agendamentos...</p>
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 shadow-sm bg-white flex flex-col items-center justify-center py-20 px-6">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 mb-4">
            <CalendarClock className="w-8 h-8 text-slate-300" />
          </div>
          <p className="text-base font-semibold text-slate-900 mb-1">Nenhum agendamento configurado</p>
          <p className="text-sm text-slate-400 text-center max-w-sm mb-5">
            Crie um agendamento para executar validações de certificações automaticamente
          </p>
          <button
            onClick={openCreateForm}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            Criar Agendamento
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className={`rounded-2xl border shadow-sm bg-white overflow-hidden transition-colors ${
                schedule.enabled
                  ? 'border-slate-200/80'
                  : 'border-slate-200/60 bg-slate-50/50'
              }`}
            >
              {/* Status accent bar */}
              <div className={`h-1 ${schedule.enabled ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-slate-200'}`} />

              <div className="p-5 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className={`text-base font-semibold truncate ${schedule.enabled ? 'text-slate-900' : 'text-slate-500'}`}>
                        {schedule.name}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                          schedule.enabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Power className="w-3 h-3" />
                        {schedule.enabled ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                        <Clock className="w-4 h-4 text-slate-400" />
                        {cronToHuman(schedule.cron_expression)}
                      </span>
                      {schedule.brand_filter && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                          <Tag className="w-3 h-3" />
                          {BRAND_OPTIONS.find((b) => b.value === schedule.brand_filter)?.label ||
                            schedule.brand_filter}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs text-slate-400">
                      {schedule.last_run && (
                        <span>Última execução: <span className="text-slate-500">{formatDateTime(schedule.last_run)}</span></span>
                      )}
                      {schedule.next_run && (
                        <span>Próxima execução: <span className="text-slate-500">{formatDateTime(schedule.next_run)}</span></span>
                      )}
                      {!schedule.last_run && !schedule.next_run && (
                        <span className="italic">Ainda não executado</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggleEnabled(schedule)}
                      disabled={togglingId === schedule.id}
                      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
                        schedule.enabled
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-inner'
                          : 'bg-slate-300'
                      }`}
                      title={schedule.enabled ? 'Desativar' : 'Ativar'}
                    >
                      <span
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                          schedule.enabled ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </button>

                    <div className="w-px h-6 bg-slate-200 mx-1" />

                    <button
                      onClick={() => handleTrigger(schedule.id)}
                      disabled={triggeringId === schedule.id}
                      className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                      title="Executar agora"
                    >
                      {triggeringId === schedule.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      onClick={() => openEditForm(schedule)}
                      className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setDeleteConfirm(schedule.id)}
                      className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => toggleHistory(schedule.id)}
                      className={`flex items-center justify-center w-9 h-9 rounded-xl transition-colors ${
                        expandedHistory === schedule.id
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                      }`}
                      title="Histórico"
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
                <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-4 md:px-6">
                  <div className="flex items-center gap-2 mb-3">
                    <History className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Últimas execuções</span>
                  </div>
                  {historyLoading === schedule.id ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                    </div>
                  ) : !historyData[schedule.id] || historyData[schedule.id].length === 0 ? (
                    <div className="flex flex-col items-center py-6">
                      <p className="text-sm text-slate-400">Nenhuma execução registrada</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {historyData[schedule.id].map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between bg-white rounded-xl border border-slate-100 px-4 py-3 text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex items-center justify-center w-2.5 h-2.5 rounded-full ${
                                entry.status === 'completed'
                                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/30'
                                  : 'bg-red-500 shadow-sm shadow-red-500/30'
                              }`}
                            />
                            <span className="text-slate-600 font-medium text-xs">
                              {formatDateTime(entry.run_date)}
                            </span>
                          </div>
                          {entry.summary && typeof entry.summary === 'object' && (
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-slate-500 font-medium">{entry.summary.total ?? 0} produtos</span>
                              {(entry.summary.ok ?? 0) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold">
                                  {entry.summary.ok} Conforme
                                </span>
                              )}
                              {(entry.summary.missing ?? 0) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 text-red-700 font-semibold">
                                  {entry.summary.missing} ausentes
                                </span>
                              )}
                              {(entry.summary.inconsistent ?? 0) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-semibold">
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
                <div className="border-t border-red-100 bg-red-50/80 px-5 py-4 md:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-red-100">
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-red-800">Excluir agendamento?</p>
                        <p className="text-xs text-red-600/70">Esta ação não pode ser desfeita</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] transition-all"
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

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => { setShowForm(false); resetForm(); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
                  {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingId ? 'Editar Agendamento' : 'Novo Agendamento'}
                </h3>
              </div>
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                className="flex items-center justify-center w-8 h-8 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nome</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Validação diária Imaginarium"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                />
              </div>

              {/* Brand */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Marca</label>
                <select
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                >
                  {BRAND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Frequência</label>
                <select
                  value={formPreset}
                  onChange={(e) => setFormPreset(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                >
                  {FREQUENCY_PRESETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Time (for non-custom presets) */}
              {formPreset !== 'custom' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Hora</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={formHour}
                      onChange={(e) => setFormHour(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Minuto</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={formMinute}
                      onChange={(e) => setFormMinute(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Custom cron */}
              {formPreset === 'custom' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Expressão Cron
                  </label>
                  <input
                    type="text"
                    value={formCustomCron}
                    onChange={(e) => setFormCustomCron(e.target.value)}
                    placeholder="0 8 * * 1-5"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all font-mono"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Formato: minuto hora dia mês dia_semana -- Ex: 0 8 * * 1-5 = dias úteis às 08:00
                  </p>
                </div>
              )}

              {/* Enabled toggle */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="text-sm font-semibold text-slate-700">Status</span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formEnabled ? 'O agendamento será executado automaticamente' : 'O agendamento está pausado'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormEnabled(!formEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
                    formEnabled
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-inner'
                      : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                      formEnabled ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Error */}
              {formError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
                  <p className="text-sm text-red-700 font-medium">{formError}</p>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-sm disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Salvar Alterações' : 'Criar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
