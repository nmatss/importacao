// Query key factories for all entities.
// Usage: queryClient.invalidateQueries({ queryKey: processKeys.detail(id) })

export const processKeys = {
  all: ['processes'] as const,
  lists: () => [...processKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...processKeys.lists(), filters ?? {}] as const,
  details: () => [...processKeys.all, 'detail'] as const,
  detail: (id: string | number) => [...processKeys.details(), id] as const,
  validations: (id: string | number) => [...processKeys.detail(id), 'validations'] as const,
  followUp: (id: string | number) => [...processKeys.detail(id), 'follow-up'] as const,
  documents: (id: string | number) => [...processKeys.detail(id), 'documents'] as const,
  emails: (id: string | number) => [...processKeys.detail(id), 'emails'] as const,
  cambios: (id: string | number) => [...processKeys.detail(id), 'cambios'] as const,
  preCons: (id: string | number) => [...processKeys.detail(id), 'pre-cons'] as const,
  events: (id: string | number) => [...processKeys.detail(id), 'events'] as const,
};

export const communicationKeys = {
  all: ['communications'] as const,
  lists: () => [...communicationKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...communicationKeys.lists(), filters ?? {}] as const,
  detail: (id: number) => [...communicationKeys.all, 'detail', id] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
  key: (key: string) => [...settingsKeys.all, key] as const,
  smtp: () => [...settingsKeys.all, 'smtp'] as const,
  integrations: () => [...settingsKeys.all, 'integrations'] as const,
  webhook: () => settingsKeys.key('google_chat_webhook'),
};

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  detail: (id: number) => [...userKeys.all, 'detail', id] as const,
};

export const emailSignatureKeys = {
  all: ['email-signatures'] as const,
  lists: () => [...emailSignatureKeys.all, 'list'] as const,
};

export const liTrackingKeys = {
  all: ['li-tracking'] as const,
  lists: () => [...liTrackingKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...liTrackingKeys.lists(), filters ?? {}] as const,
  stats: () => [...liTrackingKeys.all, 'stats'] as const,
  detail: (id: number) => [...liTrackingKeys.all, 'detail', id] as const,
};

export const documentKeys = {
  all: ['documents'] as const,
  process: (processId: string | number) => [...documentKeys.all, 'process', processId] as const,
  detail: (id: number) => [...documentKeys.all, 'detail', id] as const,
};

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...auditLogKeys.lists(), filters ?? {}] as const,
};

export const followUpKeys = {
  all: ['follow-up'] as const,
  process: (processId: string | number) => [...followUpKeys.all, processId] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  overview: () => [...dashboardKeys.all, 'overview'] as const,
};

export const emailIngestionKeys = {
  all: ['email-ingestion'] as const,
  status: () => [...emailIngestionKeys.all, 'status'] as const,
  logs: (filters?: Record<string, unknown>) =>
    [...emailIngestionKeys.all, 'logs', filters ?? {}] as const,
};
