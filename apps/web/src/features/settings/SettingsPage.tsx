import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

interface SettingValue {
  key: string;
  value: string;
}

type TabKey = 'general' | 'users' | 'integrations';

const tabs: { key: TabKey; label: string; icon: typeof Settings }[] = [
  { key: 'general', label: 'Geral', icon: Settings },
  { key: 'users', label: 'Usuarios', icon: Users },
  { key: 'integrations', label: 'Integracoes', icon: Link2 },
];

const roleBadge: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  operator: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-700',
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Configuracoes</h2>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'integrations' && <IntegrationsTab />}
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
    } finally {
      setSavingSmtp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Google Chat Webhook</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://chat.googleapis.com/v1/spaces/..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveWebhook}
              disabled={savingWebhook}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
            {savedWebhook && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" /> Salvo
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Configuracoes SMTP</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Porta</label>
            <input
              type="text"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
            <input
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remetente (From)</label>
            <input
              type="email"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={handleSaveSmtp}
            disabled={savingSmtp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
          {savedSmtp && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" /> Salvo
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });
  const [saving, setSaving] = useState(false);

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
        const payload: Record<string, string> = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/api/auth/users/${editUser.id}`, payload);
      } else {
        await api.post('/api/auth/users', form);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    await api.delete(`/api/auth/users/${deactivateId}`);
    queryClient.invalidateQueries({ queryKey: ['users'] });
    setDeactivateId(null);
  };

  const toggleActive = async (user: User) => {
    await api.put(`/api/auth/users/${user.id}`, { active: !user.active });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  if (isLoading) return <LoadingSpinner className="py-12" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Novo Usuario
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Nome</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Perfil</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Ativo</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users?.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{user.name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{user.email}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      roleBadge[user.role] || roleBadge.viewer
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    onClick={() => toggleActive(user)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      user.active ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                        user.active ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(user)}
                      className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeactivateId(user.id)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Desativar"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* User modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editUser ? 'Editar Usuario' : 'Novo Usuario'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Senha{editUser ? ' (deixe vazio para manter)' : ''}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required={!editUser}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Perfil</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Google Drive</h3>
          <StatusIndicator status={driveStatus} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Email</label>
            <input
              type="email"
              value={driveEmail}
              onChange={(e) => setDriveEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Root Folder ID</label>
            <input
              type="text"
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={testDrive}
            disabled={testingDrive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {testingDrive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Testar Conexao
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Odoo</h3>
          <StatusIndicator status={odooStatus} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={odooUrl}
              onChange={(e) => setOdooUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Database</label>
            <input
              type="text"
              value={odooDb}
              onChange={(e) => setOdooDb(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
            <input
              type="text"
              value={odooUser}
              onChange={(e) => setOdooUser(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={testOdoo}
            disabled={testingOdoo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {testingOdoo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Testar Conexao
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Integracoes
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" /> Salvo
          </span>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: 'idle' | 'success' | 'error' }) {
  if (status === 'idle') return null;
  return status === 'success' ? (
    <span className="flex items-center gap-1 text-sm text-green-600">
      <CheckCircle className="h-4 w-4" /> Conectado
    </span>
  ) : (
    <span className="flex items-center gap-1 text-sm text-red-600">
      <XCircle className="h-4 w-4" /> Falha na conexao
    </span>
  );
}
