import React from 'react';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue, type User } from '@/shared/contexts/AuthContext';

export const mockUser: User = {
  id: '1',
  name: 'Test User',
  email: 'test@grupounico.com',
  role: 'analyst',
};

export const mockAuthValue: AuthContextValue = {
  user: mockUser,
  loading: false,
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
};

export function MockAuthProvider({
  children,
  value = mockAuthValue,
}: {
  children: React.ReactNode;
  value?: Partial<AuthContextValue>;
}) {
  return (
    <AuthContext.Provider value={{ ...mockAuthValue, ...value }}>
      {children}
    </AuthContext.Provider>
  );
}

export function MockUnauthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{ ...mockAuthValue, user: null }}>
      {children}
    </AuthContext.Provider>
  );
}
