'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, TOKEN_KEY, type User } from './api.ts';

interface AuthCtx {
  user: User;
  logout: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside RequireAuth');
  return c;
};

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function RequireAuth({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  // the token lives in localStorage, so it can only be read in the browser (never during SSR)
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  useEffect(() => {
    const present = !!localStorage.getItem(TOKEN_KEY);
    setHasToken(present);
    if (!present) router.replace('/login');
  }, [router]);
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<User>('/auth/me')).data,
    enabled: hasToken === true,
  });

  // slots are validated server-side in the user's timezone: keep it in sync with the browser
  useEffect(() => {
    if (user && user.timezone !== browserTz()) {
      api
        .patch<User>('/auth/me', { timezone: browserTz() })
        .then((r) => qc.setQueryData(['me'], r.data))
        .catch(() => undefined);
    }
  }, [user, qc]);

  if (hasToken === false) return null; // redirecting to /login
  if (hasToken === null || isLoading || !user)
    return (
      <div className="center">
        <div className="loader">
          <span className="spinner" />
          <span>Loading your workspace…</span>
        </div>
      </div>
    );

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    qc.clear();
    location.assign('/login');
  };
  return <Ctx.Provider value={{ user, logout }}>{children}</Ctx.Provider>;
}
