import { useState, useEffect, useCallback } from 'react';
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
  FileText,
  FileSignature,
  Trash2,
  Star,
  Eye,
} from 'lucide-react';
import { settingsKeys, userKeys, emailSignatureKeys } from '@/shared/api/query-keys';
import { useApiQuery } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/hooks/useAuth';
import { api } from '@/shared/lib/api-client';
import { PageSkeleton } from '@/shared/components/Skeleton';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { cn } from '@/shared/lib/utils';
import { getErrorMessage } from '@/shared/utils/errors';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
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

interface CommunicationTemplateData {
  id: number;
  name: string;
  recipient: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
  isActive: boolean;
}

type TabKey = 'email' | 'users' | 'integrations' | 'templates' | 'signatures';

const tabs: { key: TabKey; label: string; icon: typeof Settings }[] = [
  { key: 'email', label: 'E-mails', icon: Mail },
  { key: 'users', label: 'Usuarios', icon: Users },
  { key: 'integrations', label: 'Integracoes', icon: Link2 },
  { key: 'templates', label: 'Modelos', icon: FileText },
  { key: 'signatures', label: 'Assinaturas', icon: FileSignature },
];

const roleBadge: Record<string, { bg: string; text: string }> = {
  admin: { bg: 'bg-danger-50', text: 'text-danger-700' },
  analyst: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

const defaultRoleBadge = {
  bg: 'bg-slate-100 dark:bg-slate-700',
  text: 'text-slate-600 dark:text-slate-400',
};

const inputClasses =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all';
const labelClasses =
  'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider';
const textareaClasses = cn(inputClasses, 'min-h-28 resize-y leading-relaxed');

function parseEmailList(value: string) {
  return value
    .split(/[;,\r\n]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function invalidEmailListItems(value: string) {
  return parseEmailList(value).filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('email');

  // Non-admins can manage operational email assets, but not system settings.
  const isNonAdmin = user?.role !== 'admin';
  const nonAdminTabs: TabKey[] = ['templates', 'signatures'];
  const visibleTabs = isNonAdmin ? tabs.filter((t) => nonAdminTabs.includes(t.key)) : tabs;
  const effectiveTab =
    isNonAdmin && !nonAdminTabs.includes(activeTab) ? ('templates' as TabKey) : activeTab;

  if (isNonAdmin && !nonAdminTabs.includes(effectiveTab)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger-50 mb-5">
          <ShieldAlert className="h-8 w-8 text-danger-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Acesso negado</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          Somente administradores podem acessar as configuracoes do sistema.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Configuracoes
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Gerencie preferencias, usuarios e integracoes
        </p>
      </div>

      {/* Pill tabs */}
      <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 p-1 overflow-x-auto max-w-full">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = effectiveTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3 sm:px-4 py-2 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {effectiveTab === 'email' && <EmailSettingsTab />}
      {effectiveTab === 'users' && <UsersTab />}
      {effectiveTab === 'integrations' && <IntegrationsTab />}
      {effectiveTab === 'templates' && <CommunicationTemplatesTab />}
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
    <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700">
              <Icon className="h-4.5 w-4.5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
              {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
            </div>
          </div>
          {actions}
        </div>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
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

function EmailSettingsTab() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [kiomEmail, setKiomEmail] = useState('');
  const [feniciaEmail, setFeniciaEmail] = useState('');
  const [isaEmail, setIsaEmail] = useState('');
  const [defaultCcEmail, setDefaultCcEmail] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [savedWebhook, setSavedWebhook] = useState(false);
  const [savedSmtp, setSavedSmtp] = useState(false);
  const [savedRecipients, setSavedRecipients] = useState(false);

  const { data: webhookSetting } = useApiQuery<SettingValue>(
    settingsKeys.webhook(),
    '/api/settings/google_chat_webhook',
  );

  const { data: smtpSettings } = useApiQuery<SettingValue[]>(
    settingsKeys.smtp(),
    '/api/settings/smtp',
  );

  const { data: recipientSettings } = useApiQuery<SettingValue[]>(
    settingsKeys.recipients(),
    '/api/settings/recipients',
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

  useEffect(() => {
    if (recipientSettings && Array.isArray(recipientSettings)) {
      for (const s of recipientSettings) {
        if (s.key === 'kiom_email') setKiomEmail(s.value || '');
        if (s.key === 'fenicia_email') setFeniciaEmail(s.value || '');
        if (s.key === 'isa_email') setIsaEmail(s.value || '');
        if (s.key === 'default_cc_email') setDefaultCcEmail(s.value || '');
      }
    }
  }, [recipientSettings]);

  const handleSaveWebhook = useCallback(async () => {
    setSavingWebhook(true);
    try {
      await api.put('/api/settings/google_chat_webhook', { value: webhookUrl });
      setSavedWebhook(true);
      setTimeout(() => setSavedWebhook(false), 2000);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingWebhook(false);
    }
  }, [webhookUrl]);

  const handleSaveSmtp = useCallback(async () => {
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingSmtp(false);
    }
  }, [smtpHost, smtpPort, smtpUser, smtpFrom]);

  const handleSaveRecipients = useCallback(async () => {
    const invalidItems = [
      ...invalidEmailListItems(kiomEmail),
      ...invalidEmailListItems(feniciaEmail),
      ...invalidEmailListItems(isaEmail),
      ...invalidEmailListItems(defaultCcEmail),
    ];

    if (invalidItems.length > 0) {
      toast.error(`E-mail inválido: ${invalidItems[0]}`);
      return;
    }

    setSavingRecipients(true);
    try {
      await api.put('/api/settings/recipients', {
        kiom_email: kiomEmail,
        fenicia_email: feniciaEmail,
        isa_email: isaEmail,
        default_cc_email: defaultCcEmail,
      });
      setSavedRecipients(true);
      setTimeout(() => setSavedRecipients(false), 2000);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingRecipients(false);
    }
  }, [kiomEmail, feniciaEmail, isaEmail, defaultCcEmail]);

  return (
    <div className="space-y-6">
      <SectionCard
        icon={Users}
        title="Destinatarios operacionais"
        description="Allowlist de envio usada por rascunhos e automacoes"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0">
              <label htmlFor="kiom-email" className={labelClasses}>
                KIOM
              </label>
              <textarea
                id="kiom-email"
                value={kiomEmail}
                onChange={(e) => setKiomEmail(e.target.value)}
                placeholder="contact@kiomglobal.com"
                className={textareaClasses}
              />
              <p className="mt-1 text-xs text-slate-400">
                {parseEmailList(kiomEmail).length} destinatário(s)
              </p>
            </div>
            <div className="min-w-0">
              <label htmlFor="fenicia-email" className={labelClasses}>
                Fenicia
              </label>
              <textarea
                id="fenicia-email"
                value={feniciaEmail}
                onChange={(e) => setFeniciaEmail(e.target.value)}
                placeholder="bruna@feniciacomex.com.br, fenicia.fin@feniciacomex.com.br"
                className={textareaClasses}
              />
              <p className="mt-1 text-xs text-slate-400">
                {parseEmailList(feniciaEmail).length} destinatário(s)
              </p>
            </div>
            <div className="min-w-0">
              <label htmlFor="isa-email" className={labelClasses}>
                ISA
              </label>
              <textarea
                id="isa-email"
                value={isaEmail}
                onChange={(e) => setIsaEmail(e.target.value)}
                placeholder="email@dominio.com"
                className={textareaClasses}
              />
              <p className="mt-1 text-xs text-slate-400">
                {parseEmailList(isaEmail).length} destinatário(s)
              </p>
            </div>
            <div className="min-w-0">
              <label htmlFor="default-cc-email" className={labelClasses}>
                Copia fixa
              </label>
              <textarea
                id="default-cc-email"
                value={defaultCcEmail}
                onChange={(e) => setDefaultCcEmail(e.target.value)}
                placeholder="global@grupounico.com"
                className={textareaClasses}
              />
              <p className="mt-1 text-xs text-slate-400">
                {parseEmailList(defaultCcEmail).length} e-mail(s) em copia
              </p>
            </div>
          </div>
          <SaveButton
            onClick={handleSaveRecipients}
            saving={savingRecipients}
            saved={savedRecipients}
          />
        </div>
      </SectionCard>

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
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const { data: users, isLoading } = useApiQuery<User[]>(userKeys.all, '/api/auth/users');

  const openCreate = () => {
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'analyst' });
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
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      setShowModal(false);
      toast.success(editUser ? 'Usuário atualizado' : 'Usuário criado');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      await api.delete(`/api/auth/users/${deactivateId}`);
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      setDeactivateId(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await api.put(`/api/auth/users/${user.id}`, { isActive: !user.isActive });
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      toast.success(user.isActive ? `${user.name} desativado` : `${user.name} ativado`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {users?.length ?? 0}
          </span>{' '}
          usuarios cadastrados
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
      <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[600px] w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80">
                <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Usuario
                </th>
                <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Email
                </th>
                <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Perfil
                </th>
                <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-3 py-2 sm:px-6 sm:py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                      'group transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/80',
                      idx !== (users?.length ?? 0) - 1 &&
                        'border-b border-slate-100 dark:border-slate-700/80',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-xl text-[11px] font-bold',
                            user.isActive
                              ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-400',
                          )}
                        >
                          {user.name
                            .split(' ')
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join('')
                            .toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {user.name}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm text-slate-500 dark:text-slate-400">
                      {user.email}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
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
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={user.isActive}
                        onClick={() => toggleActive(user)}
                        aria-label={
                          user.isActive ? `Desativar ${user.name}` : `Ativar ${user.name}`
                        }
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                          user.isActive ? 'bg-primary-600' : 'bg-slate-200',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-5 w-5 rounded-full bg-white dark:bg-slate-800 shadow-sm transition-transform duration-200',
                            user.isActive ? 'translate-x-5' : 'translate-x-0',
                          )}
                        />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-6 sm:py-3.5">
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
      </div>

      {/* User modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-4">
          <div className="fixed inset-0" onClick={() => setShowModal(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-modal-title"
            className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
          >
            <h2
              id="user-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-5"
            >
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
                  <option value="analyst">Analista</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-all duration-200"
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
    settingsKeys.integrations(),
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
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
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 disabled:opacity-50 transition-all duration-200 shadow-sm"
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

function CommunicationTemplatesTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CommunicationTemplateData | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    recipient: '',
    recipientEmail: '',
    subject: '',
    body: '',
    isActive: true,
  });

  const { data: templates, isLoading } = useApiQuery<CommunicationTemplateData[]>(
    settingsKeys.communicationTemplates(),
    '/api/settings/communication-templates?active=false',
  );

  const resetForm = () => {
    setEditing(null);
    setForm({
      name: '',
      recipient: '',
      recipientEmail: '',
      subject: '',
      body: '',
      isActive: true,
    });
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (template: CommunicationTemplateData) => {
    setEditing(template);
    setForm({
      name: template.name,
      recipient: template.recipient ?? '',
      recipientEmail: template.recipientEmail ?? '',
      subject: template.subject,
      body: template.body,
      isActive: template.isActive,
    });
    setShowModal(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const invalidItems = invalidEmailListItems(form.recipientEmail);
    if (invalidItems.length > 0) {
      toast.error(`E-mail inválido: ${invalidItems[0]}`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        recipient: form.recipient || null,
        recipientEmail: form.recipientEmail || null,
        subject: form.subject,
        body: form.body,
        isActive: form.isActive,
      };
      if (editing) {
        await api.put(`/api/settings/communication-templates/${editing.id}`, payload);
      } else {
        await api.post('/api/settings/communication-templates', payload);
      }
      queryClient.invalidateQueries({ queryKey: settingsKeys.communicationTemplates() });
      setShowModal(false);
      resetForm();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deletingId) return;
    try {
      await api.delete(`/api/settings/communication-templates/${deletingId}`);
      queryClient.invalidateQueries({ queryKey: settingsKeys.communicationTemplates() });
      setDeletingId(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <SectionCard
        icon={FileText}
        title="Modelos de Atendimento"
        description="Modelos reutilizaveis para rascunhos e envios de e-mail"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-primary-700 hover:to-primary-800 transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo Modelo
          </button>
        }
      >
        {!templates || templates.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-slate-400">Nenhum modelo cadastrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Modelo
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Destinatario
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Assunto
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Acoes
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr
                    key={template.id}
                    className="border-b border-slate-100 last:border-b-0 dark:border-slate-700"
                  >
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {template.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {template.recipientEmail || template.recipient || '--'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {template.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'rounded-lg px-2.5 py-1 text-xs font-semibold',
                          template.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {template.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(template)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600"
                          aria-label={`Editar modelo ${template.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {template.isActive && (
                          <button
                            type="button"
                            onClick={() => setDeletingId(template.id)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600"
                            aria-label={`Desativar modelo ${template.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-4">
          <div className="fixed inset-0" onClick={() => setShowModal(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-modal-title"
            className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
          >
            <h2
              id="template-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-5"
            >
              {editing ? 'Editar Modelo' : 'Novo Modelo'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="template-name" className={labelClasses}>
                    Nome
                  </label>
                  <input
                    id="template-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClasses}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="template-recipient" className={labelClasses}>
                    Destinatario
                  </label>
                  <input
                    id="template-recipient"
                    value={form.recipient}
                    onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                    className={inputClasses}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="template-recipient-email" className={labelClasses}>
                  E-mail destinatario
                </label>
                <input
                  id="template-recipient-email"
                  value={form.recipientEmail}
                  onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })}
                  placeholder="email@exemplo.com, outro@exemplo.com"
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="template-subject" className={labelClasses}>
                  Assunto
                </label>
                <input
                  id="template-subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className={inputClasses}
                  required
                />
              </div>
              <div>
                <label htmlFor="template-body" className={labelClasses}>
                  Mensagem
                </label>
                <textarea
                  id="template-body"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className={cn(inputClasses, 'min-h-[180px]')}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600"
                />
                Ativo para uso nos atendimentos
              </label>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
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
        title="Desativar Modelo"
        message="Este modelo deixara de aparecer nos atendimentos, mas o historico sera preservado."
        confirmLabel="Desativar"
        onConfirm={handleDeactivate}
        onCancel={() => setDeletingId(null)}
      />
    </div>
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
    emailSignatureKeys.all,
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
      queryClient.invalidateQueries({ queryKey: emailSignatureKeys.all });
      setShowModal(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await api.delete(`/api/settings/email-signatures/${deletingId}`);
      queryClient.invalidateQueries({ queryKey: emailSignatureKeys.all });
      setDeletingId(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSetDefault = async (sig: EmailSignatureData) => {
    try {
      await api.put(`/api/settings/email-signatures/${sig.id}`, { isDefault: true });
      queryClient.invalidateQueries({ queryKey: emailSignatureKeys.all });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700">
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
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {sig.name}
                    </span>
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
                        title="Definir como padrão"
                        aria-label={`Definir ${sig.name} como padrão`}
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewId(previewId === sig.id ? null : sig.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-700 hover:text-slate-600 dark:text-slate-400 transition-all duration-200"
                      title="Visualizar"
                      aria-label={`Visualizar assinatura ${sig.name}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openEdit(sig)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-all duration-200"
                      title="Editar"
                      aria-label={`Editar assinatura ${sig.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeletingId(sig.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-danger-50 hover:text-danger-600 transition-all duration-200"
                      title="Excluir"
                      aria-label={`Excluir assinatura ${sig.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {previewId === sig.id && (
                  <div
                    className="mt-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-4 text-sm text-slate-700 dark:text-slate-300 prose prose-sm max-w-none"
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
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signature-modal-title"
            className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
          >
            <h2
              id="signature-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-5"
            >
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
                  Conteúdo HTML da assinatura
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
                  <label className={labelClasses}>Pré-visualização</label>
                  <div
                    className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 p-4 text-sm text-slate-700 dark:text-slate-300 prose prose-sm max-w-none"
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
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Definir como assinatura padrão
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-all duration-200"
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
