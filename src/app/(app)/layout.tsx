import type { ReactNode } from 'react';
import { RequireAuth } from '@/auth';
import AppShell from '@/components/AppShell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
