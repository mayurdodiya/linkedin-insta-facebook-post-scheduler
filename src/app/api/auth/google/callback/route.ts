import { services } from '@/server/container';
import { redirectTo, route } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams;
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const error = q.get('error') ?? '';
  if (error || !code) return redirectTo(req, `/login?error=${encodeURIComponent(error || 'google_failed')}`);
  try {
    const token = await services.auth.googleCallback(code, state);
    return redirectTo(req, `/auth/callback?token=${encodeURIComponent(token)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'google_failed';
    return redirectTo(req, `/login?error=${encodeURIComponent(msg)}`);
  }
});
