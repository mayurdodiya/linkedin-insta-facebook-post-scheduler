'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import Link from 'next/link';
import { api, PLATFORM_LABEL, PLATFORM_SHORT, type PostItem, type PostStatus } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { toast } from '../toast.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  AlertIcon,
  BoltIcon,
  CalendarIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  ClockIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
} from '../components/Icons.tsx';

const STAT_ICONS = {
  scheduled: ClockIcon,
  published: CheckCircleIcon,
  failed: AlertIcon,
} as const;

export default function Dashboard() {
  const { ask, dialog: confirmDialog } = useConfirm();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [facebookPageId, setFacebookPageId] = useState(user.facebook?.selectedPageId ?? '');
  const fb = user.facebook;

  useEffect(() => {
    setFacebookPageId(fb?.selectedPageId ?? fb?.pages[0]?.id ?? '');
  }, [fb]);

  // result of the LinkedIn OAuth redirect: /dashboard?linkedin=connected | ?linkedin_error=...
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('linkedin') === 'connected') {
      toast.success('LinkedIn connected successfully.');
      void qc.invalidateQueries({ queryKey: ['me'] });
    } else if (q.get('linkedin_error')) {
      toast.error(`LinkedIn connection failed: ${q.get('linkedin_error')}`);
    }
    if (q.get('instagram') === 'connected') {
      toast.success('Instagram connected successfully.');
      void qc.invalidateQueries({ queryKey: ['me'] });
    } else if (q.get('instagram_error')) {
      toast.error(`Instagram connection failed: ${q.get('instagram_error')}`);
    }
    if (q.get('facebook') === 'connected') {
      toast.success('Facebook connected. Choose which Page to publish to below.');
      void qc.invalidateQueries({ queryKey: ['me'] });
    } else if (q.get('facebook_error')) {
      toast.error(`Facebook connection failed: ${q.get('facebook_error')}`);
    }
    if (q.size) history.replaceState(null, '', location.pathname);
  }, [qc]);

  const igConnect = useMutation({
    mutationFn: async () => (await api.get<{ url: string }>('/instagram/connect-url')).data.url,
    onSuccess: (url) => location.assign(url),
  });
  const igDisconnect = useMutation({
    mutationFn: () => api.delete('/instagram'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const connect = useMutation({
    mutationFn: async () => (await api.get<{ url: string }>('/linkedin/connect-url')).data.url,
    onSuccess: (url) => location.assign(url),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete('/linkedin'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const facebookConnect = useMutation({
    mutationFn: async () => (await api.get<{ url: string }>('/facebook/connect-url')).data.url,
    onSuccess: (url) => location.assign(url),
  });
  const facebookDisconnect = useMutation({
    mutationFn: () => api.delete('/facebook'),
    onSuccess: () => {
      setFacebookPageId('');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const facebookSelectPage = useMutation({
    mutationFn: () => api.post('/facebook/select-page', { pageId: facebookPageId }),
    onSuccess: () => {
      toast.success('Facebook Page selected.');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: async () => (await api.get<Record<string, number>>('/posts/stats')).data,
  });
  const upcoming = useQuery({
    queryKey: ['posts', 'upcoming'],
    queryFn: async () =>
      (await api.get<PostItem[]>('/posts', { params: { from: new Date().toISOString() } })).data,
  });

  // one row per composed post even when it goes to several networks
  const upcomingRows = useMemo(() => {
    const rows: { key: string; posts: PostItem[] }[] = [];
    const index = new Map<string, number>();
    for (const p of upcoming.data ?? []) {
      const k = p.groupId ?? p.id;
      const at = index.get(k);
      if (at === undefined) {
        index.set(k, rows.length);
        rows.push({ key: k, posts: [p] });
      } else {
        rows[at].posts.push(p);
      }
    }
    return rows;
  }, [upcoming.data]);

  const rowStatus = (posts: PostItem[]): PostStatus => {
    if (posts.some((p) => p.status === 'publishing')) return 'publishing';
    if (posts.every((p) => p.status === 'published')) return 'published';
    if (posts.some((p) => p.status === 'failed')) return 'failed';
    return 'scheduled';
  };

  const li = user.linkedin;
  const daysLeft = li ? Math.ceil((new Date(li.expiresAt).getTime() - Date.now()) / 86400000) : 0;

  const ig = user.instagram;
  const igDaysLeft = ig ? Math.ceil((new Date(ig.expiresAt).getTime() - Date.now()) / 86400000) : 0;
  const selectedFacebookPage = fb?.pages.find((page) => page.id === fb.selectedPageId);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>Hi {user.name.split(' ')[0]} 👋</h1>
          <p className="muted">Here&apos;s what&apos;s happening with your content today.</p>
        </div>
        <div className="actions">
          <Link className="btn ghost" href="/planner?instant=1">
            <BoltIcon />
            Post now
          </Link>
          <Link className="btn primary" href="/planner">
            <CalendarPlusIcon />
            Plan posts
          </Link>
        </div>
      </div>

      <section className="channels">
        <div className="card channel">
          <div className="channel-head">
            <span className="platform-icon">
              <LinkedinIcon />
            </span>
            <div className="grow">
              <h2>LinkedIn</h2>
              <p className="muted small">Publish text, photos and video to your network.</p>
            </div>
            {li ? (
              li.expired ? (
                <span className="status-pill off">Expired</span>
              ) : daysLeft <= 7 ? (
                <span className="status-pill warn">Expiring</span>
              ) : (
                <span className="status-pill on">Connected</span>
              )
            ) : (
              <span className="status-pill off">Not connected</span>
            )}
          </div>

          <div className="channel-body">
            {!li && <p className="muted small">Connect your account so we can publish on your behalf.</p>}
            {li && (
              <div className="who">
                {li.picture && <img src={li.picture} alt="" referrerPolicy="no-referrer" />}
                <div>
                  <strong>{li.name ?? 'LinkedIn member'}</strong>
                  <div className={li.expired || daysLeft <= 7 ? 'warn small' : 'muted small'}>
                    {li.expired
                      ? 'Connection expired - reconnect to keep posting'
                      : `Connected · token valid for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}`}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button className="btn primary" disabled={connect.isPending} onClick={() => connect.mutate()}>
              <LinkedinIcon />
              {li ? 'Reconnect' : 'Connect LinkedIn'}
            </button>
            {li && (
              <button
                className="btn ghost"
                onClick={async () => {
                  const ok = await ask({
                    title: 'Disconnect LinkedIn?',
                    message: 'Scheduled posts will fail until you reconnect.',
                    confirmLabel: 'Disconnect',
                    danger: true,
                  });
                  if (ok) disconnect.mutate();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="card channel">
          <div className="channel-head">
            <span className="platform-icon facebook">
              <FacebookIcon />
            </span>
            <div className="grow">
              <h2>Facebook Pages</h2>
              <p className="muted small">Publish text, photos and video to a Page you manage.</p>
            </div>
            {selectedFacebookPage ? (
              <span className="status-pill on">Connected</span>
            ) : fb ? (
              <span className="status-pill warn">Choose a Page</span>
            ) : (
              <span className="status-pill off">Not connected</span>
            )}
          </div>

          <div className="channel-body">
            {!fb && (
              <p className="muted small">
                Connect Meta and grant access to at least one Facebook Page. Personal profile publishing is not supported.
              </p>
            )}
            {fb && (
              <>
                <p className="muted small">
                  {selectedFacebookPage
                    ? `Publishing to ${selectedFacebookPage.name}.`
                    : 'Select the Facebook Page to receive your posts.'}
                </p>
                <div className="row">
                  <select
                    className="page-select"
                    aria-label="Facebook Page"
                    value={facebookPageId}
                    onChange={(e) => setFacebookPageId(e.target.value)}
                  >
                    {fb.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn primary"
                    disabled={
                      !facebookPageId ||
                      facebookPageId === fb.selectedPageId ||
                      facebookSelectPage.isPending
                    }
                    onClick={() => facebookSelectPage.mutate()}
                  >
                    Use this Page
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="actions">
            <button
              className="btn primary"
              disabled={facebookConnect.isPending}
              onClick={() => facebookConnect.mutate()}
            >
              <FacebookIcon />
              {fb ? 'Reconnect Facebook' : 'Connect Facebook'}
            </button>
            {fb && (
              <button
                className="btn ghost"
                onClick={async () => {
                  const ok = await ask({
                    title: 'Disconnect Facebook?',
                    message: 'Scheduled Facebook posts will fail until you reconnect.',
                    confirmLabel: 'Disconnect',
                    danger: true,
                  });
                  if (ok) facebookDisconnect.mutate();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="card channel">
          <div className="channel-head">
            <span className="platform-icon instagram">
              <InstagramIcon />
            </span>
            <div className="grow">
              <h2>Instagram</h2>
              <p className="muted small">Share photos, carousels and Reels with your audience.</p>
            </div>
            {ig ? (
              ig.expired ? (
                <span className="status-pill off">Expired</span>
              ) : igDaysLeft <= 7 ? (
                <span className="status-pill warn">Expiring</span>
              ) : (
                <span className="status-pill on">Connected</span>
              )
            ) : (
              <span className="status-pill off">Not connected</span>
            )}
          </div>

          <div className="channel-body">
            {!ig && (
              <p className="muted small">
                Connect an Instagram Business or Creator account to publish photos, carousels and Reels.
              </p>
            )}
            {ig && (
              <div className="who">
                {ig.picture && <img src={ig.picture} alt="" referrerPolicy="no-referrer" />}
                <div>
                  <strong>@{ig.username}</strong>
                  <div className={ig.expired || igDaysLeft <= 7 ? 'warn small' : 'muted small'}>
                    {ig.expired
                      ? 'Connection expired - reconnect to keep posting'
                      : `Connected · token renews automatically (valid ${igDaysLeft} more day${igDaysLeft === 1 ? '' : 's'})`}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button className="btn primary" disabled={igConnect.isPending} onClick={() => igConnect.mutate()}>
              <InstagramIcon />
              {ig ? 'Reconnect' : 'Connect Instagram'}
            </button>
            {ig && (
              <button
                className="btn ghost"
                onClick={async () => {
                  const ok = await ask({
                    title: 'Disconnect Instagram?',
                    message: 'Scheduled Instagram posts will fail until you reconnect.',
                    confirmLabel: 'Disconnect',
                    danger: true,
                  });
                  if (ok) igDisconnect.mutate();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="stats">
        {(['scheduled', 'published', 'failed'] as const).map((k) => {
          const Icon = STAT_ICONS[k];
          return (
            <div className={`card stat stat-${k}`} key={k}>
              <span className="stat-icon">
                <Icon />
              </span>
              <div className="num">{stats.data?.[k] ?? '–'}</div>
              <div className="stat-label">{k}</div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="section-head">
          <span className="stat-icon" style={{ marginBottom: 0, width: 32, height: 32 }}>
            <CalendarIcon />
          </span>
          <div className="grow">
            <h2>Coming up</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Your next scheduled posts across every connected network.
            </p>
          </div>
          <Link className="btn ghost" href="/planner">
            Open planner
          </Link>
        </div>

        {upcoming.data?.length === 0 && (
          <div className="empty">
            <span className="empty-icon">
              <CalendarPlusIcon />
            </span>
            <strong>Nothing scheduled yet</strong>
            <p className="muted small">
              {li || ig || selectedFacebookPage
                ? 'Open the planner and add your posts for the month.'
                : 'Connect a social account, then plan your month.'}
            </p>
          </div>
        )}

        <ul className="list">
          {upcomingRows.slice(0, 8).map((row) => {
            const first = row.posts[0];
            const at = new Date(first.scheduledAt);
            return (
              <li key={row.key}>
                <div className="when">
                  <span className="when-date">{at.getDate()}</span>
                  <span className="when-mon">{at.toLocaleDateString([], { month: 'short' })}</span>
                  <span className="when-time">
                    {at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                {row.posts.map((p) => (
                  <span key={p.id} className={`badge plat ${p.platform}`} title={PLATFORM_LABEL[p.platform]}>
                    {PLATFORM_SHORT[p.platform]}
                  </span>
                ))}
                <div className="grow ellipsis">{first.content || `(${first.media.length} media)`}</div>
                <StatusBadge status={rowStatus(row.posts)} />
              </li>
            );
          })}
        </ul>
      </section>
      {confirmDialog}
    </>
  );
}
