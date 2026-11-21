import axios, { AxiosError } from 'axios';

export const TOKEN_KEY = 'lps_token';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    const url = err.config?.url ?? '';
    if (err.response?.status === 401 && !url.startsWith('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }
    return Promise.reject(err);
  },
);

export function errMsg(e: unknown): string {
  const m = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (m) return m;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export interface LinkedinInfo {
  name?: string;
  picture?: string;
  expiresAt: string;
  expired: boolean;
}
export interface InstagramInfo {
  username: string;
  picture?: string;
  expiresAt: string;
  expired: boolean;
}
export interface FacebookInfo {
  pages: { id: string; name: string; picture?: string }[];
  selectedPageId?: string;
}
export type Platform = 'linkedin' | 'instagram' | 'facebook';
export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
};
export const PLATFORM_SHORT: Record<Platform, string> = { linkedin: 'in', instagram: 'IG', facebook: 'f' };
export const PLATFORM_TEXT_LIMIT: Record<Platform, number> = {
  linkedin: 3000,
  instagram: 2200,
  facebook: 63206,
};

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  timezone: string;
  linkedin: LinkedinInfo | null;
  instagram: InstagramInfo | null;
  facebook: FacebookInfo | null;
}
export interface MediaItem {
  filename: string;
  originalName: string;
  kind: 'image' | 'video';
  size: number;
  url: string;
}
export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'failed';
export interface PostItem {
  id: string;
  platform: Platform;
  /** set when one composed post is published to several networks (one item per network) */
  groupId?: string;
  permalink?: string;
  content: string;
  scheduledAt: string;
  status: PostStatus;
  attempts: number;
  lastError?: string;
  linkedinPostUrn?: string;
  publishedAt?: string;
  media: MediaItem[];
}

export interface BulkResult {
  /** number of composed posts (days) created */
  count: number;
  created: PostItem[];
  /** ISO instants whose slot was already used and were left untouched */
  skipped: string[];
}

/** Up to a month of daily posts in one go. */
export const BULK_MAX_POSTS = 30;
/** photos per multi-day upload (several can share one day) */
export const BULK_MAX_PHOTOS = 60;

/**
 * Scheduled posts go out once a day: the Vercel free plan only runs the cron one time (10:00 AM IST,
 * see vercel.json). So there is a single slot; only "Post now" publishes at an arbitrary moment.
 */
export const SLOT_HOURS = [10];
export const SLOT_LABEL = '10:00 AM IST';

export const fmtHour = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
