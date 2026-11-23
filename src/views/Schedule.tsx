'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  api,
  fmtHour,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  SLOT_HOURS,
  SLOT_LABEL,
  type Platform,
  type PostItem,
  type PostStatus,
} from '../api.ts';
import { useAuth } from '../auth.tsx';
import { toast } from '../toast.tsx';
import { PostModal } from '../components/PostModal.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { CloseIcon } from '../components/Icons.tsx';

/* ---------- small local helpers (kept here on purpose: nothing shared is changed) ---------- */

const PLATFORM_ORDER: Record<Platform, number> = { linkedin: 0, instagram: 1, facebook: 2 };
const FETCH_LIMIT = 1000; // the server returns at most this many posts per request

/** Local calendar date as YYYY-MM-DD (the value format of <input type="date">). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Parse YYYY-MM-DD as a local midnight (new Date('YYYY-MM-DD') would be UTC). */
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

function groupStatus(posts: PostItem[]): PostStatus {
  if (posts.some((p) => p.status === 'publishing')) return 'publishing';
  if (posts.every((p) => p.status === 'published')) return 'published';
  if (posts.some((p) => p.status === 'failed')) return 'failed';
  return 'scheduled';
}

/** One composed post: every per-network copy (same groupId) collapses into a single row. */
interface Row {
  key: string;
  posts: PostItem[];
  at: Date;
  status: PostStatus;
}

type StatusFilter = 'all' | PostStatus;
type NetworkFilter = 'all' | Platform;

export default function Schedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = useMemo(() => new Date(), []);

  // default view: everything from today onwards for the next 30 days
  const [from, setFrom] = useState(ymd(today));
  const [to, setTo] = useState(ymd(addDays(today, 30)));
  const [status, setStatus] = useState<StatusFilter>('all');
  const [network, setNetwork] = useState<NetworkFilter>('all');
  const [newestFirst, setNewestFirst] = useState(false);

  const rangeInvalid = !!from && !!to && from > to;

  // fire once when the picked range becomes invalid (the axios interceptor covers API failures)
  useEffect(() => {
    if (rangeInvalid) toast.error('"From" must be on or before "To".');
  }, [rangeInvalid]);

  const { data: fetched = [], isLoading, isError } = useQuery({
    // starts with 'posts' so the composer's invalidateQueries(['posts']) refreshes this table too
    queryKey: ['posts', 'table', from, to],
    enabled: !rangeInvalid,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (from) params.from = fromYmd(from).toISOString();
      if (to) params.to = addDays(fromYmd(to), 1).toISOString(); // `to` is inclusive; the API's is exclusive
      return (await api.get<PostItem[]>('/posts', { params })).data;
    },
  });

  const rows = useMemo<Row[]>(() => {
    const groups = new Map<string, PostItem[]>();
    for (const p of fetched) {
      const k = p.groupId ?? p.id;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const all = [...groups.entries()].map(([key, ps]) => {
      const sorted = [...ps].sort((a, b) => PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform]);
      return { key, posts: sorted, at: new Date(sorted[0].scheduledAt), status: groupStatus(sorted) };
    });
    return all
      .filter((r) => (status === 'all' ? true : r.status === status))
      .filter((r) => (network === 'all' ? true : r.posts.some((p) => p.platform === network)))
      .sort((a, b) => (newestFirst ? b.at.getTime() - a.at.getTime() : a.at.getTime() - b.at.getTime()));
  }, [fetched, status, network, newestFirst]);

  const connected: Platform[] = [
    ...(user.linkedin ? (['linkedin'] as const) : []),
    ...(user.instagram ? (['instagram'] as const) : []),
    ...(user.facebook?.selectedPageId ? (['facebook'] as const) : []),
  ];

  /* ---------- presets ---------- */
  const preset = (days: number | 'month' | 'all') => {
    const t = new Date();
    setFrom(ymd(t));
    if (days === 'month') setTo(ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)));
    else if (days === 'all') setTo('');
    else setTo(ymd(addDays(t, days)));
  };
  const reset = () => {
    preset(30);
    setStatus('all');
    setNetwork('all');
  };

  /* ---------- edit (the existing composer, unchanged) ---------- */
  const [editing, setEditing] = useState<{ day: Date; post: PostItem; groupPosts: PostItem[] } | null>(null);
  function openEdit(r: Row) {
    // prefer a copy that can still be edited (the other network may already be published)
    const primary = r.posts.find((p) => p.status === 'scheduled' || p.status === 'failed') ?? r.posts[0];
    setEditing({ day: r.at, post: primary, groupPosts: r.posts });
  }

  /* ---------- reschedule (date only) ---------- */
  const [resched, setResched] = useState<Row | null>(null);

  const isEditable = (r: Row) => r.posts.some((p) => p.status === 'scheduled' || p.status === 'failed');

  return (
    <>
      <div className="page-head">
        <div className="cal-title">
          <span className="eyebrow">Schedule</span>
          <h1>Scheduled posts</h1>
          <p className="muted small">Every post by date. Filter by date range, status or network, then edit or reschedule.</p>
        </div>
      </div>

      <div className="card sch-filters">
        <div className="sch-fields">
          <label className="sch-field">
            <span>From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="sch-field">
            <span>To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="sch-field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
              <option value="publishing">Publishing</option>
            </select>
          </label>
          <label className="sch-field">
            <span>Network</span>
            <select value={network} onChange={(e) => setNetwork(e.target.value as NetworkFilter)}>
              <option value="all">All networks</option>
              {(['linkedin', 'instagram', 'facebook'] as const).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sch-presets">
          <button type="button" className="btn ghost" onClick={() => preset(7)}>
            Next 7 days
          </button>
          <button type="button" className="btn ghost" onClick={() => preset(30)}>
            Next 30 days
          </button>
          <button type="button" className="btn ghost" onClick={() => preset('month')}>
            This month
          </button>
          <button type="button" className="btn ghost" onClick={() => preset('all')}>
            All upcoming
          </button>
          <button type="button" className="btn ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      <div className="card sch-table-card">
        <div className="sch-summary muted small">
          {isLoading
            ? 'Loading…'
            : `${rows.length} post${rows.length === 1 ? '' : 's'}`}
          {fetched.length >= FETCH_LIMIT && ` · showing the first ${FETCH_LIMIT} in this range - narrow the dates to see the rest`}
        </div>

        {!isLoading && !isError && rows.length === 0 && !rangeInvalid && (
          <div className="sch-empty">No posts match these filters.</div>
        )}

        {rows.length > 0 && (
          <div className="sch-scroll">
            <table className="sch-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="sch-sort" onClick={() => setNewestFirst((v) => !v)}>
                      Date {newestFirst ? '↓' : '↑'}
                    </button>
                  </th>
                  <th>Networks</th>
                  <th>Post</th>
                  <th>Status</th>
                  <th className="sch-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const first = r.posts[0];
                  const err = r.posts.find((p) => p.lastError)?.lastError;
                  const mediaCount = first.media.length;
                  return (
                    <tr key={r.key}>
                      <td data-label="Date">
                        <div className="sch-date">
                          {r.at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="muted small">{fmtHour(r.at.getHours())}</div>
                      </td>
                      <td data-label="Networks">
                        <div className="sch-nets">
                          {r.posts.map((p) => (
                            <span key={p.id} className={`badge plat ${p.platform}`} title={PLATFORM_LABEL[p.platform]}>
                              {PLATFORM_SHORT[p.platform]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td data-label="Post">
                        <div className="sch-content">{first.content.trim() || <span className="muted">Media only</span>}</div>
                        {mediaCount > 0 && (
                          <div className="muted small">
                            {mediaCount} {first.media[0].kind === 'video' ? 'video' : mediaCount === 1 ? 'photo' : 'photos'}
                          </div>
                        )}
                      </td>
                      <td data-label="Status">
                        <span title={err}>
                          <StatusBadge status={r.status} />
                        </span>
                      </td>
                      <td data-label="Actions" className="sch-actions-col">
                        <div className="sch-actions">
                          <button type="button" className="btn ghost" onClick={() => openEdit(r)}>
                            {isEditable(r) ? 'Edit' : 'View'}
                          </button>
                          {isEditable(r) && (
                            <button type="button" className="btn ghost" onClick={() => setResched(r)}>
                              Reschedule
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <PostModal
          day={editing.day}
          post={editing.post}
          groupPosts={editing.groupPosts}
          dayPosts={fetched.filter((p) => sameDay(new Date(p.scheduledAt), editing.day))}
          defaultPlatforms={connected}
          onClose={() => setEditing(null)}
        />
      )}

      {resched && (
        <RescheduleDialog
          row={resched}
          others={fetched}
          onClose={() => setResched(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['posts'] });
            void qc.invalidateQueries({ queryKey: ['stats'] });
            setResched(null);
          }}
        />
      )}
    </>
  );
}

/** Move one composed post to another day (same daily slot). Only the date is sent to the API. */
function RescheduleDialog({
  row,
  others,
  onClose,
  onDone,
}: {
  row: Row;
  others: PostItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(ymd(row.at));

  const editable = row.posts.filter((p) => p.status === 'scheduled' || p.status === 'failed');
  const primary = editable[0];
  const ids = new Set(row.posts.map((p) => p.id));
  const slotOf = (d: string) => {
    const day = fromYmd(d);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), SLOT_HOURS[0]);
  };
  const minDate = ymd(slotOf(ymd(new Date())).getTime() > Date.now() ? new Date() : addDays(new Date(), 1));

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('scheduledAt', slotOf(date).toISOString());
      return api.patch(`/posts/${primary.id}`, fd);
    },
    onSuccess: onDone,
    // API failures are toasted by the axios interceptor
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return toast.error('Pick a date.');
    const slot = slotOf(date);
    if (slot.getTime() <= Date.now())
      return toast.error(`That ${SLOT_LABEL} slot has already passed - pick a later day.`);
    if (slot.getTime() === new Date(primary.scheduledAt).getTime()) return onClose(); // unchanged
    const taken = others.some(
      (p) =>
        !ids.has(p.id) &&
        editable.some((m) => m.platform === p.platform) &&
        new Date(p.scheduledAt).getTime() === slot.getTime(),
    );
    if (taken) return toast.error('You already have a post in that time slot on one of these networks.');
    save.mutate();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="modal card" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="row modal-head">
          <h2>Reschedule post</h2>
          <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          <div>
            <p className="small" style={{ marginTop: 0 }}>
              {row.posts.map((p) => PLATFORM_LABEL[p.platform]).join(' + ')} · currently{' '}
              {row.at.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            <label className="sch-field" style={{ marginTop: '0.9rem' }}>
              <span>New date</span>
              <input type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <p className="muted small">It will be published at {SLOT_LABEL} on the new date.</p>
          </div>
        </div>
        <div className="row modal-foot">
          <div className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save new date'}
          </button>
        </div>
      </form>
    </div>
  );
}
