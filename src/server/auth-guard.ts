import type { NextRequest } from 'next/server';
import { UnauthorizedException } from './http';
import { services } from './container';

export interface AuthUser {
  id: string;
}

/** Bearer-token guard (same rules as the previous JwtAuthGuard). */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new UnauthorizedException('Missing token');
  try {
    const payload = await services.jwt.verifyAsync<{ sub: string; typ?: string }>(token);
    // OAuth state tokens carry `typ` and must never work as session tokens
    if (payload.typ) throw new Error('wrong token type');
    return { id: payload.sub };
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}
