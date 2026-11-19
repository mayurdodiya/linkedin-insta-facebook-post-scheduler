'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TOKEN_KEY } from '../api.ts';

/** Landing page for the Google OAuth redirect: /auth/callback?token=... */
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token');
    if (!token) {
      router.replace('/login?error=Google%20sign-in%20failed');
      return;
    }
    localStorage.setItem(TOKEN_KEY, token);
    router.replace('/dashboard');
  }, [router]);
  return null;
}
