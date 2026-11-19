import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from './db';

/**
 * Same error shape Nest produced ({ statusCode, message, error }) so the UI's errMsg() keeps working.
 */
export class HttpException extends Error {
  constructor(
    readonly status: number,
    readonly body: string | string[],
    readonly errorName: string,
  ) {
    super(Array.isArray(body) ? body.join(', ') : body);
    this.name = 'HttpException';
  }
}

/** The bundler may load this module more than once, so don't rely on `instanceof` alone. */
export function isHttpException(e: unknown): e is HttpException {
  return (
    e instanceof HttpException ||
    (e instanceof Error && e.name === 'HttpException' && typeof (e as HttpException).status === 'number')
  );
}
export class BadRequestException extends HttpException {
  constructor(message: string | string[]) {
    super(400, message, 'Bad Request');
  }
}
export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(401, message, 'Unauthorized');
  }
}
export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(404, message, 'Not Found');
  }
}
export class ConflictException extends HttpException {
  constructor(message: string) {
    super(409, message, 'Conflict');
  }
}
export class PayloadTooLargeException extends HttpException {
  constructor(message = 'File too large') {
    super(413, message, 'Payload Too Large');
  }
}
export class ServiceUnavailableException extends HttpException {
  constructor(message: string) {
    super(503, message, 'Service Unavailable');
  }
}

export type RouteCtx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: RouteCtx) => Promise<unknown> | unknown;

export function errorResponse(e: unknown) {
  if (isHttpException(e)) {
    return NextResponse.json({ statusCode: e.status, message: e.body, error: e.errorName }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
}

/** Wraps a route handler: returned values become JSON, thrown HttpExceptions become Nest-style errors. */
export function route(handler: Handler) {
  return async (req: NextRequest, ctx: RouteCtx) => {
    try {
      await connectDb();
      const result = await handler(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? null);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Redirect within this deployment (OAuth callbacks send the browser back to the SPA). */
export const redirectTo = (req: NextRequest, path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
