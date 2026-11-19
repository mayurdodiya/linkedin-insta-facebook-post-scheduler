/** Drop-in replacement for Nest's ConfigService (same get / getOrThrow API) backed by process.env. */
export class ConfigService {
  get<T = string>(key: string): T | undefined {
    const v = process.env[key];
    return (v === undefined || v === '' ? undefined : v) as T | undefined;
  }

  getOrThrow<T = string>(key: string): T {
    const v = this.get<T>(key);
    if (v === undefined) throw new Error(`Configuration key "${key}" does not exist`);
    return v;
  }
}

/**
 * Public base URL of this app (OAuth redirect URIs). APP_URL wins; BACKEND_URL is the legacy name;
 * on Vercel the production domain is a last-resort default.
 */
export function appBaseUrl(config: ConfigService): string {
  const url =
    config.get<string>('APP_URL') ||
    config.get<string>('BACKEND_URL') ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!url) throw new Error('Set APP_URL to the public URL of this app');
  return url.replace(/\/$/, '');
}
