'use client';

import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  api,
  fmtHour,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  type Platform,
  type PostItem,
  type PostStatus,
} from '../api.ts';
import { useAuth } from '../auth.tsx';
import { PostModal } from '../components/PostModal.tsx';
import {
  BoltIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '../components/Icons.tsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** One calendar chip per composed post: a group of per-network copies collapses into one entry. */
interface Chip {
  key: string;
  posts: PostItem[];
}

const PLATFORM_ORDER: Record<Platform, number> = { linkedin: 0, instagram: 1, facebook: 2 };

function chipStatus(posts: PostItem[]): PostStatus {
  if (posts.some((p) => p.status === 'publishing')) return 'publishing';
  if (posts.every((p) => p.status === 'published')) return 'published';
  if (posts.some((p) => p.status === 'failed')) return 'failed';
  return 'scheduled';
}

export default function Planner() {
  const { user } = useAuth();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  // every connected network is always shown: the composer already lets the user pick the networks
  const filter: 'all' | Platform = 'all';
  const [picked, setPicked] = useState<{
    day: Date;
    post?: PostItem;
    groupPosts?: PostItem[];
    instant?: boolean;
    bulk?: boolean;
  } | null>(null);

  // /planner?instant=1 (the dashboard's "Post now") opens the instant-post popup straight away.
  // useSearchParams is read here (not location.search) because on a client-side navigation the
  // browser URL is only updated after this component first renders.
  const router = useRouter();
  const wantsInstant = useSearchParams().has('instant');
  useEffect(() => {
    if (!wantsInstant) return;
    setPicked({ day: new Date(), instant: true });
    router.replace('/planner'); // so a refresh doesn't reopen it
  }, [wantsInstant, router]);

  const from = cursor;
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const { data: allPosts = [] } = useQuery({
    queryKey: ['posts', 'month', from.toISOString()],
    queryFn: async () =>
      (await api.get<PostItem[]>('/posts', { params: { from: from.toISOString(), to: to.toISOString() } })).data,
  });

  const posts = useMemo(
    () => (filter === 'all' ? allPosts : allPosts.filter((p) => p.platform === filter)),
    [allPosts, filter],
  );

  const byDay = useMemo(() => {
    const days = new Map<string, Map<string, PostItem[]>>();
    for (const p of posts) {
      const k = dayKey(new Date(p.scheduledAt));
      const g = p.groupId ?? p.id;
      const groups = days.get(k) ?? new Map<string, PostItem[]>();
      groups.set(g, [...(groups.get(g) ?? []), p]);
      days.set(k, groups);
    }
    const out = new Map<string, Chip[]>();
    for (const [k, groups] of days) {
      out.set(
        k,
        [...groups.entries()].map(([key, ps]) => ({
          key,
          posts: [...ps].sort((a, b) => PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform]),
        })),
      );
    }
    return out;
  }, [posts]);

  // Monday-first grid
  const lead = (cursor.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ];
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const connected: Platform[] = [
    ...(user.linkedin ? (['linkedin'] as const) : []),
    ...(user.instagram ? (['instagram'] as const) : []),
    ...(user.facebook?.selectedPageId ? (['facebook'] as const) : []),
  ];
  // "All" means every connected network: one composer, one click, every platform.
  const defaultPlatforms: Platform[] = filter === 'all' ? connected : [filter];

  function openChip(day: Date, chip: Chip) {
    // when the calendar is filtered to one network, still open the whole composed post
    const groupPosts = chip.posts[0].groupId
      ? allPosts.filter((p) => p.groupId === chip.posts[0].groupId)
      : chip.posts;
    // prefer a copy that can still be edited (the other network may already be published)
    const primary = groupPosts.find((p) => p.status === 'scheduled' || p.status === 'failed') ?? groupPosts[0];
    setPicked({ day, post: primary, groupPosts });
  }

  const [showHint, setShowHint] = useState(false);
  const monthLabel = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div className="cal-title">
          <span className="eyebrow">Content calendar</span>
          <div className="month-nav">
            <button
              className="btn ghost icon"
              aria-label="Previous month"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            >
              <ChevronLeftIcon />
            </button>
            <h1>{monthLabel}</h1>
            <button
              className="btn ghost icon"
              aria-label="Next month"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setPicked({ day: today, bulk: true })}>
            <CalendarPlusIcon />
            Plan a month
          </button>
          <button className="btn primary" onClick={() => setPicked({ day: today, instant: true })}>
            <BoltIcon />
            Post now
          </button>
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="cal-legend">
          <span className="legend-item">
            <span className="legend-dot scheduled" /> Scheduled
          </span>
          <span className="legend-item">
            <span className="legend-dot published" /> Published
          </span>
          <span className="legend-item">
            <span className="legend-dot failed" /> Failed
          </span>
        </div>
        <button type="button" className="hint-toggle" aria-expanded={showHint} onClick={() => setShowHint((v) => !v)}>
          <Info />
          How planning works
        </button>
      </div>
      {showHint && (
        <div className="cal-hint-box open">
          <ul className="cal-hint-list">
            <li>Click a day to add a post with text and photos for that date.</li>
            <li>Scheduled posts are published once a day at 10:00 AM IST. Use Post now to publish immediately.</li>
            <li>Plan a month: upload many photos, each gets its own day. Drag photos between days to post them together.</li>
            <li>New posts go to every connected network by default - untick one in the composer to skip it.</li>
          </ul>
        </div>
      )}

      {!user.linkedin && !user.instagram && !user.facebook?.selectedPageId && (
        <div className="alert error">
          No publishing account connected - connect LinkedIn, Instagram, or a Facebook Page on the dashboard first.
        </div>
      )}
      <div className="cal">
        {WEEKDAYS.map((d) => (
          <div className="cal-head" key={d}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-cell empty" />;
          const items = byDay.get(dayKey(d)) ?? [];
          const past = d < startOfToday;
          return (
            <div
              key={i}
              className={`cal-cell${past ? ' past' : ''}${dayKey(d) === dayKey(today) ? ' today' : ''}`}
              onClick={() => !past && setPicked({ day: d })}
              role={past ? undefined : 'button'}
              tabIndex={past ? undefined : 0}
              aria-label={past ? undefined : `Add a post on ${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`}
              onKeyDown={(e) => {
                if (past || e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPicked({ day: d });
                }
              }}
            >
              <div className="cal-num">{d.getDate()}</div>
              {items.map((c) => {
                const first = c.posts[0];
                const status = chipStatus(c.posts);
                const title = c.posts
                  .map((p) => `${PLATFORM_LABEL[p.platform]}${p.lastError ? ` - ${p.lastError}` : ''}`)
                  .join('\n');
                return (
                  <button
                    key={c.key}
                    className={`chip ${status}`}
                    title={title || first.content}
                    onClick={(e) => {
                      e.stopPropagation();
                      openChip(d, c);
                    }}
                  >
                    <b>{c.posts.map((p) => PLATFORM_SHORT[p.platform]).join('+')}</b>{' '}
                    <span className="chip-text">
                      {fmtHour(new Date(first.scheduledAt).getHours())} · {first.content.slice(0, 20) || 'media'}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {picked && (
        <PostModal
          day={picked.day}
          post={picked.post}
          groupPosts={picked.groupPosts}
          instant={picked.instant}
          initialBulk={picked.bulk}
          dayPosts={allPosts.filter((p) => dayKey(new Date(p.scheduledAt)) === dayKey(picked.day))}
          defaultPlatforms={defaultPlatforms}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}
