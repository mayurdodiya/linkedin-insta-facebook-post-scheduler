import { BadRequestException } from './http';

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
  timezone?: string;
}
export interface LoginDto {
  email: string;
  password: string;
}
export interface UpdateProfileDto {
  name?: string;
  timezone?: string;
}

// Mirrors the previous class-validator rules and messages (whitelist: unknown fields are dropped).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function check(errors: string[], body: Record<string, unknown>, field: string, opts: { min?: number; max?: number; email?: boolean; optional?: boolean }) {
  const v = body[field];
  if (v === undefined || v === null) {
    if (!opts.optional) errors.push(opts.email ? `${field} must be an email` : `${field} must be a string`);
    return;
  }
  if (opts.email) {
    if (typeof v !== 'string' || !EMAIL.test(v)) errors.push(`${field} must be an email`);
    return;
  }
  if (typeof v !== 'string') return void errors.push(`${field} must be a string`);
  if (opts.min !== undefined && v.length < opts.min) errors.push(`${field} must be longer than or equal to ${opts.min} characters`);
  if (opts.max !== undefined && v.length > opts.max) errors.push(`${field} must be shorter than or equal to ${opts.max} characters`);
}

function done(errors: string[]) {
  if (errors.length) throw new BadRequestException(errors);
}

export function parseRegister(b: Record<string, unknown>): RegisterDto {
  const e: string[] = [];
  check(e, b, 'name', { min: 1, max: 100 });
  check(e, b, 'email', { email: true });
  check(e, b, 'password', { min: 8, max: 128 });
  check(e, b, 'timezone', { optional: true });
  done(e);
  return { name: b.name as string, email: b.email as string, password: b.password as string, timezone: b.timezone as string | undefined };
}

export function parseLogin(b: Record<string, unknown>): LoginDto {
  const e: string[] = [];
  check(e, b, 'email', { email: true });
  check(e, b, 'password', {});
  done(e);
  return { email: b.email as string, password: b.password as string };
}

export function parseUpdateProfile(b: Record<string, unknown>): UpdateProfileDto {
  const e: string[] = [];
  check(e, b, 'name', { min: 1, max: 100, optional: true });
  check(e, b, 'timezone', { optional: true });
  done(e);
  return { name: b.name as string | undefined, timezone: b.timezone as string | undefined };
}
