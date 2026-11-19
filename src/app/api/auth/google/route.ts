import { NextResponse } from 'next/server';
import { services } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';

export const GET = route(async () => NextResponse.redirect(await services.auth.googleAuthUrl()));
