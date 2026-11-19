import { services } from '@/server/container';
import { redirectTo, route } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams;
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const error = q.get('error') ?? '';
  const errorDescription = q.get('error_description') ?? '';
  if (error || !code) {
    const msg = errorDescription || error || 'facebook_failed';
    return redirectTo(req, `/dashboard?facebook_error=${encodeURIComponent(msg)}`);
  }
  try {
    await services.facebook.handleCallback(code, state);
    return redirectTo(req, '/dashboard?facebook=connected');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'facebook_failed';
    return redirectTo(req, `/dashboard?facebook_error=${encodeURIComponent(msg)}`);
  }
});
