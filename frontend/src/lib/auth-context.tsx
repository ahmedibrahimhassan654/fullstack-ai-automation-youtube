'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

export type User = {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  avatarUrl?: string | null;
  preferences?: { timezone: string; defaultLanguage: string };
  subscription?: { plan: string; status: string };
  youtube?: {
    channelId?: string | null;
    channelTitle?: string | null;
    /** The language the connected channel publishes in. */
    language?: string | null;
    connectedAt?: string | null;
  };
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const res = await api.get<{ user: User }>('/api/auth/me');
    if (res.success && res.data?.user) {
      setUser(res.data.user);
    } else {
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await refreshUser();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ user: User; accessToken: string }>('/api/auth/login', { email, password });
    if (!res.success || !res.data) throw new Error(res.message || 'Login failed');
    api.setToken(res.data.accessToken);
    setUser(res.data.user);
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await api.post<{ user: User; accessToken: string }>('/api/auth/register', { name, email, password });
    if (!res.success || !res.data) throw new Error(res.message || 'Registration failed');
    api.setToken(res.data.accessToken);
    setUser(res.data.user);
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    api.setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
