import { createContext, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/shared/lib/api-client';

const TOKEN_KEY = 'importacao_token';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get<User>('/api/auth/me')
      .then((data) => setUser(data))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<{ token: string; user: User }>('/api/auth/login', {
        email,
        password,
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate('/portal');
    },
    [navigate],
  );

  const loginWithGoogle = useCallback(
    async (credential: string) => {
      const data = await api.post<{ token: string; user: User }>('/api/auth/google', {
        credential,
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      navigate('/portal');
    },
    [navigate],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    navigate('/login');
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
