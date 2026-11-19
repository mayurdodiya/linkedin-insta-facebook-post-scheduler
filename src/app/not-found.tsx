'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Unknown URLs fall back to the dashboard (which sends signed-out users to /login). */
export default function NotFound() {
  const router = useRouter();
  useEffect(() => router.replace('/dashboard'), [router]);
  return null;
}
