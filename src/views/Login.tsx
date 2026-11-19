'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errMsg, TOKEN_KEY, type User } from '../api.ts';
import { browserTz } from '../auth.tsx';
import { BoltIcon, CalendarIcon, CheckIcon, InstagramIcon, LinkedinIcon, SendIcon } from '../components/Icons.tsx';
import { ThemeToggle } from '../theme.tsx';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // already signed in -> straight to the app; otherwise show an OAuth error passed in the URL
    if (localStorage.getItem(TOKEN_KEY)) {
      router.replace('/dashboard');
      return;
    }
    setError(new URLSearchParams(location.search).get('error') ?? '');
  }, [router]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body =
        mode === 'signup'
          ? { ...form, timezone: browserTz() }
          : { email: form.email, password: form.password };
      const { data } = await api.post<{ token: string; user: User }>(
        mode === 'signup' ? '/auth/register' : '/auth/login',
        body,
      );
      localStorage.setItem(TOKEN_KEY, data.token);
      router.replace('/dashboard');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <ThemeToggle compact />
      <aside className="auth-aside">
        <div className="brand-row">
          <span className="brand-mark">
            <BoltIcon />
          </span>
          <span>
            <span className="brand-name">in Scheduler</span>
            <span className="brand-sub">Social publishing studio</span>
          </span>
        </div>

        <div className="auth-hero">
          <span className="pill">
            <SendIcon width={13} height={13} /> Plan once. Publish everywhere.
          </span>
          <h1>Turn one idea into a month of content.</h1>
          <p>
            Build your calendar in minutes, then let in Scheduler publish to LinkedIn and Instagram
            automatically — right on time, every time.
          </p>
          <ul className="auth-features">
            <li>
              <span className="tick">
                <CheckIcon />
              </span>
              Schedule LinkedIn and Instagram together
            </li>
            <li>
              <span className="tick">
                <CheckIcon />
              </span>
              Bulk-plan a full month in a single upload
            </li>
            <li>
              <span className="tick">
                <CheckIcon />
              </span>
              Visual calendar, reminders and publishing status
            </li>
          </ul>
        </div>

        <p className="auth-foot small">© {new Date().getFullYear()} in Scheduler</p>
      </aside>

      <main className="auth-main">
        <form className="card auth" onSubmit={submit}>
          <div className="auth-mobile-brand">
            <div className="brand-row">
              <span className="brand-mark">
                <BoltIcon />
              </span>
              <span>
                <span className="brand-name">in Scheduler</span>
                <span className="brand-sub">Social publishing studio</span>
              </span>
            </div>
          </div>

          <div className="row" style={{ marginBottom: '0.9rem' }}>
            <span className="platform-icon" style={{ width: 36, height: 36, borderRadius: 11 }}>
              <CalendarIcon />
            </span>
            <span className="badge scheduled" style={{ marginLeft: 'auto' }}>
              {mode === 'login' ? 'Welcome back' : 'Get started'}
            </span>
          </div>

          <h1>{mode === 'login' ? 'Log in to your studio' : 'Create your account'}</h1>
          <p className="sub">
            {mode === 'login'
              ? 'Pick up right where you left off.'
              : 'Plan a whole month of LinkedIn and Instagram posts in one sitting.'}
          </p>

          <a className="btn google" href="/api/auth/google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.5 5.8c4.4-4.1 7-10.1 7-17.5z" />
              <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <div className="or">
            <span>or continue with email</span>
          </div>

          {mode === 'signup' && (
            <label>
              Name
              <input required value={form.name} onChange={set('name')} autoComplete="name" placeholder="Your full name" />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={set('email')}
              autoComplete="email"
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              minLength={mode === 'signup' ? 8 : 1}
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="••••••••"
            />
            {mode === 'signup' && <span className="muted small">At least 8 characters</span>}
          </label>

          {error && <div className="alert error">{error}</div>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
          <p className="muted small center-text foot">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Log in'}
            </button>
          </p>

          <div className="row small muted" style={{ justifyContent: 'center', gap: '0.4rem' }}>
            <LinkedinIcon width={13} height={13} />
            <InstagramIcon width={13} height={13} />
            <span>Works with LinkedIn &amp; Instagram</span>
          </div>
        </form>
      </main>
    </div>
  );
}
