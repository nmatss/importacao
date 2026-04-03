import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Settings,
  Users,
  Link2,
  Save,
  Plus,
  Pencil,
  UserX,
  CheckCircle,
  XCircle,
  Loader2,
  ShieldAlert,
  Mail,
  MessageSquare,
  HardDrive,
  Database,
  Zap,
  FileSignature,
  Trash2,
  Star,
  Eye,
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { api } from '@/shared/lib/api-client';
import { PageSkeleton } from '@/shared/components/Skeleton';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { cn } from '@/shared/lib/utils';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

interface SettingValue {
  key: string;
  value: string;
}

interface EmailSignatureData {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
}

type TabKey = 'general' | 'users' | 'integrations' | 'signatures';

const tabs: { key: TabKey; label: string; icon: typeof Settings }[] = [
  { key: 'general', label: 'Geral', icon: Settings },
  { key: 'users', label: 'Usuarios', icon: Users },
  { key: 'integrations', label: 'Integracoes', icon: Link2 },
  { key: 'signatures', label: 'Assinaturas', icon: FileSignature },
];

const roleBadge: Record<string, { bg: string; text: string }> = {
  admin: { bg: 'bg-danger-50', text: 'text-danger-700' },
  manager: { bg: 'bg-primary-50', text: 'text-primary-700' },
  operator: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  viewer: { bg: 'bg-slate-100', text: 'text-slate-600' },
};

const defaultRoleBadge = { bg: 'bg-slate-100', text: 'text-slate-600' };

const inputClasses =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all';
const labelClasses = 'block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider';

export function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  // Non-admins can only access the signatures tab
  const isNonAdmin = user?.role !== 'admin';
  const visibleTabs = isNonAdmin ? tabs.filter((t) => t.key === 'signatures') : tabs;
  const effectiveTab =
    isNonAdmin && activeTab !== ('signatures' as TabKey) ? ('signatures' as TabKey) : activeTab;

  if (isNonAdmin && effectiveTab !== 'signatures') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger-50 mb-5">
          <ShieldAlert className="h-8 w-8 text-danger-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Acesso negado</h2>
        <p className="mt-2 text-sm text-slate-500 max-w-sm">
          Somente administradores podem acessar as configuracoes do sistema.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Configuracoes</h2>
        <p className="mt-1 text-sm text-slate-500">Gerencie preferencias, usuarios e integracoes</p>
      </div>

      {/* Pill tabs */}
      <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = effectiveTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {effectiveTab === 'general' && <GeneralTab />}
      {effectiveTab === 'users' && <UsersTab />}
      {effectiveTab === 'integrations' && <IntegrationsTab />}
      {effectiveTab === 'signatures' && <SignaturesTab />}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  actions,
}: {
  icon: typeof Settings;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
              <Icon className="h-4.5 w-4.5 text-slate-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
              {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
            </div>
          </div>
          {actions}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function SaveButton({
  onClick,
  saving,
  saved,
  label = 'Salvar',
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {label}
      </button>
      {saved && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 animate-in fade-in">
          <CheckCircle className="h-3.5 w-3.5" />
          Salvo com sucesso
        </span>
      )}
    </div>
  );
}

function GeneralTab() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savedWebhook, setSavedWebhook] = useState(false);
  const [savedSmtp, setSavedSmtp] = useState(false);

  const { data: webhookSetting } = useApiQuery<SettingValue>(
    ['settings', 'google_chat_webhook'],
    '/api/settings/google_chat_webhook',
  );

  const { data: smtpSettings } = useApiQuery<SettingValue[]>(
    ['settings', 'smtp'],
    '/api/settings/smtp',
  );

  useEffect(() => {
    if (webhookSetting) setWebhookUrl(webhookSetting.value || '');
  }, [webhookSetting]);

  useEffect(() => {
    if (smtpSettings && Array.isArray(smtpSettings)) {
      for (const s of smtpSettings) {
        if (s.key === 'smtp_host') setSmtpHost(s.value || '');
        if (s.key === 'smtp_port') setSmtpPort(s.value || '');
        if (s.key === 'smtp_user') setSmtpUser(s.value || '');
        if (s.key === 'smtp_from') setSmtpFrom(s.value || '');
      }
    }
  }, [smtpSettings]);

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    try {
      await api.put('/api/settings/google_chat_webhook', { value: webhookUrl });
      setSavedWebhook(true);
      setTimeout(() => setSavedWebhook(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar webhook');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      await api.put('/api/settings/smtp', {
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_from: smtpFrom,
      });
      setSavedSmtp(true);
      setTimeout(() => setSavedSmtp(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configuracoes SMTP');
    } finally {
      setSavingSmtp(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        icon={MessageSquare}
        title="Google Chat Webhook"
        description="Notificacoes via Google Chat"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="webhook-url" className={labelClasses}>
              Webhook URL
            </label>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://chat.googleapis.com/v1/spaces/..."
              className={inputClasses}
            />
          </div>
          <SaveButton onClick={handleSaveWebhook} saving={savingWebhook} saved={savedWebhook} />
        </div>
      </SectionCard>

      <SectionCard
        icon={Mail}
        title="Configuracoes SMTP"
        description="Servidor de envio de e-mails"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="smtp-host" className={labelClasses}>
                Host
              </label>
              <input
                id="smtp-host"
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="smtp-port" className={labelClasses}>
                Porta
              </label>
              <input
                id="smtp-port"
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="smtp-user" className={labelClasses}>
                Usuario
              </label>
              <input
                id="smtp-user"
                type="text"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="usuario@empresa.com"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="smtp-from" className={labelClasses}>
                Remetente (From)
              </label>
              <input
                id="smtp-from"
                type="email"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder="noreply@empresa.com"
                className={inputClasses}
              />
            </div>
          </div>
          <SaveButton onClick={handleSaveSmtp} saving={savingSmtp} saved={savedSmtp} />
        </div>
      </SectionCard>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deactivateId, setDeactivateId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const { data: users, isLoading } = useApiQuery<User[]>(['users'], '/api/auth/users');

  const openCreate = () => {
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'operator' });
    setShowModal(true);
  };

  const openEdit = (user: User) => {
    setEditUser(user);
    setForm({ name: user.name, email: user.email, password: '', role: user.role });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editUser) {
        const payload: Record<string, string> = {
          name: form.name,
          email: form.email,
          role: form.role,
        };
        if (form.password) payload.password = form.password;
        await api.put(`/api/auth/users/${editUser.id}`, payload);
      } else {
        await api.post('/api/auth/users', form);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      await api.delete(`/api/auth/users/${deactivateId}`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeactivateId(null);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao desativar usuario');
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await api.put(`/api/auth/users/${user.id}`, { active: !user.active });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao alterar status do usuario');
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{users?.length ?? 0}</span> usuarios
          cadastrados
        </p>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo Usuario
        </button>
      </div>

      {/* Users table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80">
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Usuario
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Email
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Perfil
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Status
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Acoes
              </th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user, idx) => {
              const badge = roleBadge[user.role] ?? defaultRoleBadge;
              return (
                <tr
                  key={user.id}
                  className={cn(
                    'group transition-colors duration-150 hover:bg-slate-50/80',
                    idx !== (users?.length ?? 0) - 1 && 'border-b border-slate-100/80',
                  )}
                >
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-xl text-[11px] font-bold',
                          user.active
                            ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white'
                            : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {user.name
                          .split(' ')
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{user.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5 text-sm text-slate-500">
                    {user.email}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold',
                        badge.bg,
                        badge.text,
                      )}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <button
                      onClick={() => toggleActive(user)}
                      aria-label={user.active ? `Desativar ${user.name}` : `Ativar ${user.name}`}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                        user.active ? 'bg-primary-600' : 'bg-slate-200',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                          user.active ? 'translate-x-5' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(user)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-all duration-200"
                        title="Editar"
                        aria-label={`Editar usuario ${user.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeactivateId(user.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600 transition-all duration-200"
                        title="Desativar"
                        aria-label={`Desativar usuario ${user.name}`}
                      >
                        <UserX className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* User modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-4">
          <div className="fixed inset-0" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <h2 className="text-lg font-bold text-slate-900 mb-5">
              {editUser ? 'Editar Usuario' : 'Novo Usuario'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="user-name" className={labelClasses}>
                  Nome
                </label>
                <input
                  id="user-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClasses}
                  required
                />
              </div>
              <div>
                <label htmlFor="user-email" className={labelClasses}>
                  Email
                </label>
                <input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputClasses}
                  required
                />
              </div>
              <div>
                <label htmlFor="user-password" className={labelClasses}>
                  Senha{editUser ? ' (deixe vazio para manter)' : ''}
                </label>
                <input
                  id="user-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputClasses}
                  required={!editUser}
                />
              </div>
              <div>
                <label htmlFor="user-role" className={labelClasses}>
                  Perfil
                </label>
                <select
                  id="user-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={inputClasses}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all duration-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 disabled:opacity-50 transition-all"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deactivateId}
        title="Desativar Usuario"
        message="Tem certeza que deseja desativar este usuario? Ele nao podera acessar o sistema."
        confirmLabel="Desativar"
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateId(null)}
      />
    </div>
  );
}

function IntegrationsTab() {
  const [driveEmail, setDriveEmail] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [odooUrl, setOdooUrl] = useState('');
  const [odooDb, setOdooDb] = useState('');
  const [odooUser, setOdooUser] = useState('');
  const [testingDrive, setTestingDrive] = useState(false);
  const [testingOdoo, setTestingOdoo] = useState(false);
  const [driveStatus, setDriveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [odooStatus, setOdooStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: integrationSettings } = useApiQuery<SettingValue[]>(
    ['settings', 'integrations'],
    '/api/settings/integrations',
  );

  useEffect(() => {
    if (integrationSettings && Array.isArray(integrationSettings)) {
      for (const s of integrationSettings) {
        if (s.key === 'drive_client_email') setDriveEmail(s.value || '');
        if (s.key === 'drive_root_folder_id') setDriveFolderId(s.value || '');
        if (s.key === 'odoo_url') setOdooUrl(s.value || '');
        if (s.key === 'odoo_db') setOdooDb(s.value || '');
        if (s.key === 'odoo_user') setOdooUser(s.value || '');
      }
    }
  }, [integrationSettings]);

  const testDrive = async () => {
    setTestingDrive(true);
    setDriveStatus('idle');
    try {
      await api.post('/api/settings/integrations/test-drive');
      setDriveStatus('success');
    } catch {
      setDriveStatus('error');
    } finally {
      setTestingDrive(false);
    }
  };

  const testOdoo = async () => {
    setTestingOdoo(true);
    setOdooStatus('idle');
    try {
      await api.post('/api/settings/integrations/test-odoo');
      setOdooStatus('success');
    } catch {
      setOdooStatus('error');
    } finally {
      setTestingOdoo(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/integrations', {
        drive_client_email: driveEmail,
        drive_root_folder_id: driveFolderId,
        odoo_url: odooUrl,
        odoo_db: odooDb,
        odoo_user: odooUser,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar integracoes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        icon={HardDrive}
        title="Google Drive"
        description="Armazenamento e sincronizacao de documentos"
        actions={<StatusIndicator status={driveStatus} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="drive-email" className={labelClasses}>
                Client Email
              </label>
              <input
                id="drive-email"
                type="email"
                value={driveEmail}
                onChange={(e) => setDriveEmail(e.target.value)}
                placeholder="service-account@project.iam.gserviceaccount.com"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="drive-folder-id" className={labelClasses}>
                Root Folder ID
              </label>
              <input
                id="drive-folder-id"
                type="text"
                value={driveFolderId}
                onChange={(e) => setDriveFolderId(e.target.value)}
                placeholder="1a2b3c4d5e6f..."
                className={inputClasses}
              />
            </div>
          </div>
          <TestConnectionButton testing={testingDrive} onClick={testDrive} />
        </div>
      </SectionCard>

      <SectionCard
        icon={Database}
        title="Odoo ERP"
        description="Integracao com sistema de gestao empresarial"
        actions={<StatusIndicator status={odooStatus} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="odoo-url" className={labelClasses}>
                URL
              </label>
              <input
                id="odoo-url"
                type="url"
                value={odooUrl}
                onChange={(e) => setOdooUrl(e.target.value)}
                placeholder="https://erp.empresa.com"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="odoo-db" className={labelClasses}>
                Database
              </label>
              <input
                id="odoo-db"
                type="text"
                value={odooDb}
                onChange={(e) => setOdooDb(e.target.value)}
                placeholder="production"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="odoo-user" className={labelClasses}>
                Usuario
              </label>
              <input
                id="odoo-user"
                type="text"
                value={odooUser}
                onChange={(e) => setOdooUser(e.target.value)}
                placeholder="admin@empresa.com"
                className={inputClasses}
              />
            </div>
          </div>
          <TestConnectionButton testing={testingOdoo} onClick={testOdoo} />
        </div>
      </SectionCard>

      <SaveButton onClick={handleSave} saving={saving} saved={saved} label="Salvar Integracoes" />
    </div>
  );
}

function TestConnectionButton({ testing, onClick }: { testing: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={testing}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-all duration-200 shadow-sm"
    >
      {testing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Zap className="h-4 w-4 text-amber-500" />
      )}
      Testar Conexao
    </button>
  );
}

function SignaturesTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editSig, setEditSig] = useState<EmailSignatureData | null>(null);
  const [form, setForm] = useState({ name: '', signatureHtml: '', isDefault: false });
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: signatures, isLoading } = useApiQuery<EmailSignatureData[]>(
    ['email-signatures'],
    '/api/settings/email-signatures',
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
        setPreviewId(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const openCreate = () => {
    setEditSig(null);
    setForm({ name: '', signatureHtml: '', isDefault: false });
    setShowModal(true);
  };

  const openEdit = (sig: EmailSignatureData) => {
    setEditSig(sig);
    setForm({ name: sig.name, signatureHtml: sig.signatureHtml, isDefault: sig.isDefault });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editSig) {
        await api.put(`/api/settings/email-signatures/${editSig.id}`, form);
      } else {
        await api.post('/api/settings/email-signatures', form);
      }
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar assinatura');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await api.delete(`/api/settings/email-signatures/${deletingId}`);
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
      setDeletingId(null);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao excluir assinatura');
    }
  };

  const handleSetDefault = async (sig: EmailSignatureData) => {
    try {
      await api.put(`/api/settings/email-signatures/${sig.id}`, { isDefault: true });
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao definir padrao');
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <SectionCard
        icon={FileSignature}
        title="Assinaturas de E-mail"
        description="Gerencie suas assinaturas para uso nos e-mails enviados (max. 4)"
        actions={
          (signatures?.length ?? 0) < 4 ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 transition-all"
            >
              <Plus className="h-4 w-4" />
              Nova Assinatura
            </button>
          ) : undefined
        }
      >
        {!signatures || signatures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <FileSignature className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm text-slate-400 font-medium">Nenhuma assinatura cadastrada.</p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar primeira assinatura
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {signatures.map((sig) => (
              <div
                key={sig.id}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  sig.isDefault
                    ? 'border-primary-200 bg-primary-50/50'
                    : 'border-slate-200 bg-white',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-800">{sig.name}</span>
                    {sig.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                        <Star className="h-3 w-3" />
                        Padrao
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!sig.isDefault && (
                      <button
                        onClick={() => handleSetDefault(sig)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-all duration-200"
                        title="Definir como padrao"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewId(previewId === sig.id ? null : sig.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all duration-200"
                      title="Visualizar"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openEdit(sig)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-all duration-200"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeletingId(sig.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600 transition-all duration-200"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {previewId === sig.id && (
                  <div
                    className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sig.signatureHtml) }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-4">
          <div className="fixed inset-0" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <h2 className="text-lg font-bold text-slate-900 mb-5">
              {editSig ? 'Editar Assinatura' : 'Nova Assinatura'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="sig-name" className={labelClasses}>
                  Nome
                </label>
                <input
                  id="sig-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Assinatura Comercial"
                  className={inputClasses}
                  required
                  maxLength={100}
                />
              </div>
              <div>
                <label htmlFor="sig-html" className={labelClasses}>
                  Conteudo HTML da Assinatura
                </label>
                <textarea
                  id="sig-html"
                  value={form.signatureHtml}
                  onChange={(e) => setForm({ ...form, signatureHtml: e.target.value })}
                  placeholder="<p>Atenciosamente,<br/>Seu Nome<br/>Cargo | Empresa</p>"
                  className={cn(inputClasses, 'min-h-[150px] font-mono text-xs')}
                  required
                />
              </div>
              {form.signatureHtml && (
                <div>
                  <label className={labelClasses}>Pre-visualizacao</label>
                  <div
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.signatureHtml) }}
                  />
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-slate-600">Definir como assinatura padrao</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all duration-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 disabled:opacity-50 transition-all"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingId}
        title="Excluir Assinatura"
        message="Tem certeza que deseja excluir esta assinatura? Esta acao nao pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}

function StatusIndicator({ status }: { status: 'idle' | 'success' | 'error' }) {
  if (status === 'idle') return null;
  return status === 'success' ? (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">
      <CheckCircle className="h-3.5 w-3.5" />
      Conectado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-50 px-3 py-1.5 text-xs font-semibold text-danger-600">
      <XCircle className="h-3.5 w-3.5" />
      Falha na conexao
    </span>
  );
}
