'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth.tsx';
import {
  api,
  BULK_MAX_POSTS,
  errMsg,
  fmtHour,
  PLATFORM_LABEL,
  PLATFORM_TEXT_LIMIT,
  SLOT_HOURS,
  type BulkResult,
  type Platform,
  type PostItem,
} from '../api.ts';
import { StatusBadge } from './StatusBadge.tsx';
import { CloseIcon } from './Icons.tsx';

const MAX_IMAGES = 9;
const BULK_DEFAULT_HOUR = 10;

interface Props {
  day: Date;
  post?: PostItem;
  /** every copy of a multi-platform post (same groupId) */
  groupPosts?: PostItem[];
  dayPosts: PostItem[];
  /** publish immediately instead of picking a slot */
  instant?: boolean;
  /** open with "one post per day" already selected */
  initialBulk?: boolean;
  defaultPlatforms?: Platform[];
  onClose: () => void;
}

export function PostModal({
  day,
  post,
  groupPosts,
  dayPosts,
  instant = false,
  initialBulk = false,
  defaultPlatforms,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const connected = useMemo<Platform[]>(
    () => [
      ...(user.linkedin ? (['linkedin'] as const) : []),
      ...(user.instagram ? (['instagram'] as const) : []),
      ...(user.facebook?.selectedPageId ? (['facebook'] as const) : []),
    ],
    [user.linkedin, user.instagram, user.facebook],
  );

  const group = useMemo(
    () => (post ? (groupPosts?.length ? groupPosts : [post]) : []),
    [post, groupPosts],
  );
  const groupIds = useMemo(() => new Set(group.map((p) => p.id)), [group]);

  const [platforms, setPlatforms] = useState<Platform[]>(() => {
    if (post) return [...new Set((groupPosts?.length ? groupPosts : [post]).map((p) => p.platform))];
    if (defaultPlatforms?.length) return defaultPlatforms;
    if (connected.length) return connected;
    return ['linkedin'];
  });

  const toInstagram = platforms.includes('instagram');
  const toFacebook = platforms.includes('facebook');
  const both = platforms.length > 1;
  const textLimit = Math.min(...platforms.map((p) => PLATFORM_TEXT_LIMIT[p]));
  const locked = post?.status === 'published' || post?.status === 'publishing';

  const takenHours = useMemo(
    () =>
      new Set(
        dayPosts
          .filter((p) => !groupIds.has(p.id) && platforms.includes(p.platform))
          .map((p) => new Date(p.scheduledAt).getHours()),
      ),
    [dayPosts, groupIds, platforms],
  );
  const slotAt = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
  const slotFree = (h: number) => !takenHours.has(h) && slotAt(h).getTime() > Date.now();

  const [hour, setHour] = useState<number | ''>(() =>
    post ? new Date(post.scheduledAt).getHours() : (SLOT_HOURS.find(slotFree) ?? ''),
  );
  const [content, setContent] = useState(post?.content ?? '');
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');

  // Multi-day mode: one photo becomes one post on its own day, all at the same time of day.
  const canBulk = !post && !instant;
  const [bulk, setBulk] = useState(canBulk && initialBulk);
  const [bulkHour, setBulkHour] = useState(BULK_DEFAULT_HOUR);
  const [captions, setCaptions] = useState<string[]>([]);
  const [bulkDone, setBulkDone] = useState<BulkResult | null>(null);

  // Start at the selected day, or the next day when today's time has already passed.
  const bulkStart = useMemo(() => {
    const first = new Date(day.getFullYear(), day.getMonth(), day.getDate(), bulkHour);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + (first.getTime() > Date.now() ? 0 : 1));
  }, [day, bulkHour]);
  const bulkSlot = (i: number) =>
    new Date(bulkStart.getFullYear(), bulkStart.getMonth(), bulkStart.getDate() + i, bulkHour);

  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const keptMedia = (post?.media ?? []).filter((m) => !removed.includes(m.filename));
  const hasVideo = keptMedia.some((m) => m.kind === 'video') || files.some((f) => f.type.startsWith('video/'));
  const maxImages = toInstagram ? (both ? MAX_IMAGES : 10) : toFacebook ? (both ? MAX_IMAGES : 10) : MAX_IMAGES;
  const maxFiles = bulk ? BULK_MAX_POSTS : maxImages;

  function switchBulk(next: boolean) {
    if (!canBulk || bulkDone) return;
    if (!next && files.length > maxImages) {
      setFiles(files.slice(0, maxImages));
      setCaptions([]);
      setError(`A single post holds at most ${maxImages} images - extra photos were removed.`);
    } else {
      setCaptions(next ? files.map(() => '') : []);
      setError('');
    }
    setBulkDone(null);
    setBulk(next);
  }

  function togglePlatform(p: Platform) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    if (next.length === 0) return; // at least one network must stay selected
    // the current slot may already be used on the newly selected network
    if (hour !== '') {
      const taken = new Set(
        dayPosts
          .filter((dp) => !groupIds.has(dp.id) && next.includes(dp.platform))
          .map((dp) => new Date(dp.scheduledAt).getHours()),
      );
      const free = (h: number) => !taken.has(h) && slotAt(h).getTime() > Date.now();
      if (!free(hour)) setHour(SLOT_HOURS.find(free) ?? '');
    }
    setError('');
    setPlatforms(next);
  }

  function addFiles(list: FileList | null) {
    if (!list || bulkDone) return;
    const incoming = Array.from(list);
    const next = [...files, ...incoming];
    if (bulk) {
      if (incoming.some((f) => f.type.startsWith('video/'))) {
        return setError('Multi-day scheduling works with photos only.');
      }
      if (toInstagram && incoming.some((f) => f.type !== 'image/jpeg')) {
        return setError('Instagram only accepts JPEG images.');
      }
      if (toFacebook && incoming.some((f) => !['image/jpeg', 'image/png'].includes(f.type))) {
        return setError('Facebook accepts JPEG or PNG photos for multi-day scheduling.');
      }
      if (next.length > BULK_MAX_POSTS) {
        return setError(`You can schedule up to ${BULK_MAX_POSTS} photos at once.`);
      }
      setError('');
      setFiles(next);
      setCaptions((c) => [...c, ...incoming.map(() => '')]);
      return;
    }
    const videos = [...keptMedia, ...next].filter((m) => ('kind' in m ? m.kind === 'video' : m.type.startsWith('video/'))).length;
    const total = keptMedia.length + next.length;
    if (toInstagram && next.some((f) => f.type.startsWith('image/') && f.type !== 'image/jpeg')) {
      return setError('Instagram only accepts JPEG images and MP4 video.');
    }
    if (
      toFacebook &&
      next.some((f) => !['image/jpeg', 'image/png', 'video/mp4'].includes(f.type))
    ) {
      return setError('Facebook accepts JPEG/PNG images and MP4 video.');
    }
    if (videos > 1 || (videos === 1 && total > 1)) return setError('A post can have one video or images, not both.');
    if (total > maxImages) return setError(`Maximum ${maxImages} images.`);
    setError('');
    setFiles(next);
  }

  function removeFile(i: number) {
    if (bulkDone) return;
    setFiles(files.filter((_, j) => j !== i));
    if (bulk) setCaptions(captions.filter((_, j) => j !== i));
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['posts'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('content', content);
      if (!post) fd.append('platforms', platforms.join(','));
      files.forEach((f) => fd.append('media', f));
      if (bulk) {
        // one slot + caption per file, in the same order the photos were appended
        files.forEach((_, i) => fd.append('scheduledAts', bulkSlot(i).toISOString()));
        files.forEach((_, i) => fd.append('captions', captions[i] ?? ''));
        return (await api.post<BulkResult>('/posts/bulk', fd)).data;
      }
      if (instant) return api.post('/posts/instant', fd);
      fd.append('scheduledAt', slotAt(hour as number).toISOString());
      removed.forEach((r) => fd.append('removeMedia', r));
      return post ? api.patch(`/posts/${post.id}`, fd) : api.post('/posts', fd);
    },
    onSuccess: (res) => {
      refresh();
      if (bulk && res && typeof res === 'object' && 'skipped' in res) {
        const result = res as BulkResult;
        if (result.skipped.length > 0) {
          // keep the modal open so the user can see which days were already taken
          setBulkDone(result);
          return;
        }
      }
      onClose();
    },
    onError: (e) => {
      refresh();
      setError(errMsg(e));
    },
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/posts/${post!.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e) => setError(errMsg(e)),
  });
  const postNow = useMutation({
    mutationFn: () => api.post(`/posts/${post!.id}/publish-now`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e) => {
      refresh();
      setError(errMsg(e));
    },
  });

  const labels = platforms.map((p) => PLATFORM_LABEL[p]).join(' + ');
  const notConnected = platforms.filter(
    (p) => !user[p] || (p === 'facebook' && !user.facebook?.selectedPageId),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (bulkDone) return; // this batch was already scheduled
    if (bulk) {
      if (files.length === 0) return setError('Add at least one photo.');
      if (files.some((f) => f.type.startsWith('video/'))) return setError('Multi-day scheduling works with photos only.');
      if (toInstagram && files.some((f) => f.type !== 'image/jpeg')) return setError('Instagram only accepts JPEG images.');
      if (files.some((_, i) => bulkSlot(i).getTime() <= Date.now())) return setError('Every post needs a future slot.');
      if (content.length > textLimit || captions.some((c) => (c ?? '').length > textLimit)) {
        return setError(`Captions are limited to ${textLimit} characters.`);
      }
      setError('');
      return save.mutate();
    }
    if (!instant && hour === '') return setError('Pick a time slot.');
    if (toInstagram && keptMedia.length + files.length === 0) return setError('Instagram posts need an image or a video.');
    if (!instant && !slotFree(hour as number)) return setError('That slot is already used on one of the selected platforms.');
    setError('');
    save.mutate();
  };
  const busy = save.isPending || del.isPending || postNow.isPending;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className={`modal card${bulk ? ' bulk' : ''}`} onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row modal-head">
          <h2 className="grow">
            {instant
              ? `Post to ${labels} now`
              : bulk
                ? `Plan multiple days · from ${day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}`
                : `${post ? 'Edit post' : 'New post'} · ${day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}`}
          </h2>
          {post && <StatusBadge status={post.status} />}
          <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {!post && (
          <div>
            {canBulk && (
              <div>
                <div className="label">Schedule</div>
                <div className="row seg">
                  <button
                    type="button"
                    className={`btn ${!bulk ? 'primary' : 'ghost'}`}
                    aria-pressed={!bulk}
                    disabled={!!bulkDone}
                    onClick={() => switchBulk(false)}
                  >
                    One post
                  </button>
                  <button
                    type="button"
                    className={`btn ${bulk ? 'primary' : 'ghost'}`}
                    aria-pressed={bulk}
                    disabled={!!bulkDone}
                    onClick={() => switchBulk(true)}
                  >
                    One post per day
                  </button>
                </div>
                {bulk && (
                  <p className="muted small">
                    Upload a whole month at once: each photo becomes its own post, one per day at the same time.
                  </p>
                )}
              </div>
            )}
            <div className="label">Post to</div>
            <div className="row seg">
              {(['linkedin', 'instagram', 'facebook'] as const).map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    className={`btn ${on ? 'primary' : 'ghost'}`}
                    aria-pressed={on}
                    title={user[p] ? undefined : 'Not connected - connect it on the dashboard first'}
                    onClick={() => togglePlatform(p)}
                  >
                    {on ? '✓ ' : ''}
                    {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
              {connected.length > 1 && platforms.length !== connected.length && (
                <button type="button" className="btn ghost" onClick={() => setPlatforms(connected)}>
                  All connected
                </button>
              )}
            </div>
            {both && (
              <p className="muted small">
                One copy is published to each network. Text and media must satisfy every selected network&apos;s limits.
              </p>
            )}
            {toInstagram && (
              <p className="muted small">
                Very tall or wide photos are automatically split into carousel panels to fit Instagram.
              </p>
            )}
            {notConnected.length > 0 && (
              <div className="alert error">
                {notConnected.includes('facebook') && !user.facebook
                  ? 'Connect Facebook and choose a Page on the dashboard first.'
                  : notConnected.includes('facebook')
                    ? 'Choose a Facebook Page on the dashboard first.'
                    : `Connect ${notConnected.map((p) => PLATFORM_LABEL[p]).join(' and ')} on the dashboard first - publishing there will fail.`}
              </div>
            )}
          </div>
        )}

        {post && group.length > 1 && (
          <div className="row small muted">
            {group.map((p) => (
              <span key={p.id} className={`badge plat ${p.platform}`}>
                {PLATFORM_LABEL[p.platform]} · {p.status}
              </span>
            ))}
          </div>
        )}
        {post && group.length > 1 && !locked && (
          <p className="muted small">
            This post goes to {group.map((p) => PLATFORM_LABEL[p.platform]).join(' + ')}. Changes are applied to every copy that
            has not been published yet.
          </p>
        )}

        {post?.lastError && <div className="alert error">{post.lastError}</div>}
        {post?.status === 'published' && (
          <div className="alert ok">
            Published {post.publishedAt && new Date(post.publishedAt).toLocaleString()}
            {post.permalink && (
              <>
                {' · '}
                <a href={post.permalink} target="_blank" rel="noreferrer">
                  View post
                </a>
              </>
            )}
          </div>
        )}

        {!instant && !bulk && (
        <label>
          Time slot
          <div className="slots">
            {SLOT_HOURS.map((h) => {
              const taken = takenHours.has(h);
              const disabled = locked || !slotFree(h);
              return (
                <button
                  type="button"
                  key={h}
                  disabled={disabled && h !== hour}
                  className={`slot${hour === h ? ' on' : ''}${taken ? ' taken' : ''}`}
                  title={taken ? 'Already used on one of the selected platforms' : undefined}
                  onClick={() => !locked && setHour(h)}
                >
                  {fmtHour(h)}
                </button>
              );
            })}
          </div>
        </label>
        )}

        {bulk && (
          <label>
            Daily time
            <div className="slots">
              {SLOT_HOURS.map((h) => (
                <button
                  type="button"
                  key={h}
                  disabled={!!bulkDone}
                  className={`slot${bulkHour === h ? ' on' : ''}`}
                  onClick={() => setBulkHour(h)}
                >
                  {fmtHour(h)}
                </button>
              ))}
            </div>
            <span className="muted small">
              {files.length === 0
                ? 'Add photos below - each one gets its own day.'
                : `${files.length} post${files.length === 1 ? '' : 's'} · ${bulkStart.toLocaleDateString([], {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })} → ${bulkSlot(files.length - 1).toLocaleDateString([], {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}, one per day at ${fmtHour(bulkHour)}.`}
            </span>
          </label>
        )}

        <label>
          {bulk ? 'Default caption' : toInstagram ? 'Caption' : 'Post text'}
          <textarea
            rows={8}
            maxLength={textLimit}
            disabled={locked || !!bulkDone}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={bulk ? 'Used for every post that has no caption of its own' : 'What do you want to share?'}
          />
          <span className="muted small right">{content.length}/{textLimit}</span>
        </label>

        <div>
          <div className="label">{bulk ? 'Photos - one per day' : 'Media'}</div>
          <div className="thumbs">
            {keptMedia.map((m) => (
              <div className="thumb" key={m.filename}>
                {m.kind === 'video' ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
                {!locked && (
                  <button type="button" className="x" onClick={() => setRemoved((r) => [...r, m.filename])}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {previews.map(({ f, url }, i) => (
              <div className="thumb" key={url}>
                {f.type.startsWith('video/') ? <video src={url} muted /> : <img src={url} alt="" />}
                {bulk && <span className="day">{i + 1}</span>}
                {!bulkDone && (
                  <button type="button" className="x" onClick={() => removeFile(i)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!locked && !bulkDone && !hasVideo && files.length < maxFiles && (
              <label className="thumb add">
                +
                <input
                  type="file"
                  hidden
                  multiple
                  accept={
                    bulk
                      ? toInstagram
                        ? 'image/jpeg'
                        : 'image/jpeg,image/png,image/gif'
                      : toInstagram
                        ? 'image/jpeg,video/mp4'
                        : toFacebook
                          ? 'image/jpeg,image/png,video/mp4'
                          : 'image/jpeg,image/png,image/gif,video/mp4'
                  }
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          <div className="muted small">
            {bulk
              ? `Up to ${BULK_MAX_POSTS} JPEG${toInstagram ? '' : '/PNG/GIF'} photos - each photo is scheduled on its own day.`
              : toInstagram
                ? `JPEG images (up to ${maxImages}, carousel) or one MP4 video (published as a Reel). Media is required by Instagram.`
                : 'JPG/PNG/GIF (up to 9) or one MP4 video.'}
          </div>

          {bulk && files.length > 0 && (
            <div className="bulk-list">
              {files.map((f, i) => (
                <div className="bulk-item" key={`${f.name}-${f.lastModified}-${i}`}>
                  <div className="bulk-when">
                    <b>Day {i + 1}</b>
                    <div className="muted small">
                      {bulkSlot(i).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                      {fmtHour(bulkHour)}
                    </div>
                  </div>
                  <input
                    className="grow"
                    type="text"
                    maxLength={textLimit}
                    disabled={!!bulkDone}
                    value={captions[i] ?? ''}
                    onChange={(e) =>
                      setCaptions((cs) => {
                        const next = [...cs];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="Caption for this post (optional - falls back to the default)"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {bulkDone && (
          <div className={`alert ${bulkDone.count > 0 ? 'ok' : 'error'}`}>
            Scheduled {bulkDone.count} post{bulkDone.count === 1 ? '' : 's'}.
            {bulkDone.skipped.length > 0 && (
              <>
                {' '}
                Skipped {bulkDone.skipped.length} day{bulkDone.skipped.length === 1 ? '' : 's'} that already had a post at{' '}
                {fmtHour(bulkHour)}:{' '}
                {bulkDone.skipped
                  .map((iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }))
                  .join(', ')}
                .
              </>
            )}
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        <div className="row modal-foot">
          {post && !locked && (
            <>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  confirm(group.length > 1 ? `Delete this post on all ${group.length} networks?` : 'Delete this post?') &&
                  del.mutate()
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() =>
                  confirm(`Publish this post to ${group.map((p) => PLATFORM_LABEL[p.platform]).join(' + ')} right now?`) &&
                  postNow.mutate()
                }
              >
                {postNow.isPending ? 'Posting…' : 'Post now'}
              </button>
            </>
          )}
          <div className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
          {!locked && (
            <button className="btn primary" disabled={busy || !!bulkDone}>
              {instant
                ? save.isPending ? 'Publishing…' : `Publish to ${labels}`
                : save.isPending
                  ? 'Saving…'
                  : bulkDone
                    ? 'Scheduled'
                    : post
                      ? 'Save changes'
                      : bulk
                        ? `Schedule ${files.length} post${files.length === 1 ? '' : 's'} to ${labels}`
                        : `Schedule to ${labels}`}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
