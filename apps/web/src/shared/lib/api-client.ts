const BASE_URL = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'importacao_token';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();
  if (json.data !== undefined && json.pagination !== undefined) {
    return { data: json.data, pagination: json.pagination } as T;
  }
  return (json.data !== undefined ? json.data : json) as T;
}

export const api = {
  get<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'GET' });
  },
  post<T>(url: string, data?: unknown): Promise<T> {
    return request<T>(url, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
  },
  put<T>(url: string, data?: unknown): Promise<T> {
    return request<T>(url, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });
  },
  patch<T>(url: string, data?: unknown): Promise<T> {
    return request<T>(url, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });
  },
  delete<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'DELETE' });
  },
};
