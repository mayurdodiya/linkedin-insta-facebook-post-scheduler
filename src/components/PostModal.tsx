'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth.tsx';
import {
  api,
  BULK_MAX_POSTS,
  BULK_MAX_PHOTOS,
  fmtHour,
  PLATFORM_LABEL,
  PLATFORM_TEXT_LIMIT,
  SLOT_HOURS,
  SLOT_LABEL,
  type BulkResult,
  type Platform,
  type PostItem,
} from '../api.ts';
import { toast } from '../toast.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { CloseIcon } from './Icons.tsx';
import { ClearButton, PasteButton } from './PasteButton.tsx';
import { useConfirm, type ConfirmItem } from './ConfirmDialog.tsx';
import { MediaPreview } from './MediaPreview.tsx';
import { shrinkImage } from '../shrinkImage.ts';
import { BulkPlanner, duplicateDates, resolveDates, revokeImages, type BulkDay } from './BulkPlanner.tsx';

const MAX_IMAGES = 9;
const BULK_DEFAULT_HOUR = SLOT_HOURS[0];

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
  const { ask, dialog: confirmDialog } = useConfirm();
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
    SLOT_HOURS.find(slotFree) ?? (post ? SLOT_HOURS[0] : ''),
  );
  const [content, setContent] = useState(post?.content ?? '');
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  // Multi-day mode: one photo becomes one post on its own day, all at the same time of day.
  const canBulk = !post && !instant;
  const bulk = canBulk && initialBulk;
  const bulkHour = BULK_DEFAULT_HOUR;
  const [days, setDaysState] = useState<BulkDay[]>([]);
  const daysRef = useRef<BulkDay[]>([]);
  const setDays = (fn: (d: BulkDay[]) => BulkDay[]) =>
    setDaysState((d) => {
      const next = fn(d);
      daysRef.current = next;
      return next;
    });
  useEffect(() => () => revokeImages(daysRef.current), []);
  const [bulkDone, setBulkDone] = useState<BulkResult | null>(null);

  // Start at the selected day, or the next day when today's time has already passed.
  const bulkStart = useMemo(() => {
    const first = new Date(day.getFullYear(), day.getMonth(), day.getDate(), bulkHour);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + (first.getTime() > Date.now() ? 0 : 1));
  }, [day, bulkHour]);
  const bulkDates = useMemo(() => resolveDates(days, bulkStart), [days, bulkStart]);
  const bulkSlot = (i: number) => {
    const d = bulkDates[i];
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), bulkHour);
  };

  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  // index into [kept media, newly picked files] of the item shown full-size
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const keptMedia = (post?.media ?? []).filter((m) => !removed.includes(m.filename));
  // media whose files are gone from server storage after publishing - nothing left to render
  const visibleMedia = keptMedia.filter((m) => !m.cleaned);
  const hasVideo = keptMedia.some((m) => m.kind === 'video') || files.some((f) => f.type.startsWith('video/'));
  const maxImages = toInstagram ? (both ? MAX_IMAGES : 10) : toFacebook ? (both ? MAX_IMAGES : 10) : MAX_IMAGES;

  /** photo-type rules for multi-day planning; '' when fine */
  const bulkCheck = (list: File[]) => {
    if (list.some((f) => f.type.startsWith('video/'))) return 'Multi-day scheduling works with photos only.';
    if (toInstagram && list.some((f) => f.type !== 'image/jpeg')) return 'Instagram only accepts JPEG images.';
    if (toFacebook && list.some((f) => !['image/jpeg', 'image/png'].includes(f.type))) {
      return 'Facebook accepts JPEG or PNG photos for multi-day scheduling.';
    }
    return '';
  };

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
    setPlatforms(next);
  }

  function addFiles(list: FileList | null) {
    if (!list || bulkDone) return;
    const incoming = Array.from(list);
    const next = [...files, ...incoming];
    const videos = [...keptMedia, ...next].filter((m) => ('kind' in m ? m.kind === 'video' : m.type.startsWith('video/'))).length;
    const total = keptMedia.length + next.length;
    if (toInstagram && next.some((f) => f.type.startsWith('image/') && f.type !== 'image/jpeg')) {
      return toast.error('Instagram only accepts JPEG images and MP4 video.');
    }
    if (
      toFacebook &&
      next.some((f) => !['image/jpeg', 'image/png', 'video/mp4'].includes(f.type))
    ) {
      return toast.error('Facebook accepts JPEG/PNG images and MP4 video.');
    }
    if (videos > 1 || (videos === 1 && total > 1))
      return toast.error('A post can have one video or images, not both.');
    if (total > maxImages) return toast.error(`Maximum ${maxImages} images.`);
    setFiles(next);
  }

  function removeFile(i: number) {
    if (bulkDone) return;
    setFiles(files.filter((_, j) => j !== i));
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['posts'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('content', content);
      fd.append('platforms', platforms.join(','));
      if (!bulk) {
        for (const f of files) fd.append('media', await shrinkImage(f));
      }
      if (bulk) {
        // one slot + caption per day; assignments[] tells which day each photo (in upload order) belongs to
        for (const [k, d] of days.entries()) {
          for (const img of d.images) {
            fd.append('media', await shrinkImage(img.file));
            fd.append('assignments', String(k));
          }
          fd.append('scheduledAts', bulkSlot(k).toISOString());
          fd.append('captions', d.caption);
        }
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
        if (result.count > 0) {
          toast.success(`Scheduled ${result.count} post${result.count === 1 ? '' : 's'}.`);
        } else if (result.skipped.length > 0) {
          toast.error('No posts were scheduled because every selected slot is already taken.');
        }
        if (result.skipped.length > 0) {
          // keep the modal open so the user can see which days were already taken
          setBulkDone(result);
          return;
        }
      } else {
        toast.success(instant ? 'Post published.' : post ? 'Post updated.' : 'Post scheduled.');
      }
      onClose();
    },
    onError: () => {
      refresh();
      // the axios interceptor already turned the failure into a toast
    },
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/posts/${post!.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const postNow = useMutation({
    mutationFn: () => api.post(`/posts/${post!.id}/publish-now`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: () => refresh(),
  });

  const notConnected = platforms.filter(
    (p) => !user[p] || (p === 'facebook' && !user.facebook?.selectedPageId),
  );

  // warn (as a toast) when a selected network has no account behind it
  const notConnectedMsg =
    notConnected.length === 0
      ? ''
      : notConnected.includes('facebook') && !user.facebook
        ? 'Connect Facebook and choose a Page on the dashboard first.'
        : notConnected.includes('facebook')
          ? 'Choose a Facebook Page on the dashboard first.'
          : `Connect ${notConnected.map((p) => PLATFORM_LABEL[p]).join(' and ')} on the dashboard first - publishing there will fail.`;
  useEffect(() => {
    if (notConnectedMsg) toast.error(notConnectedMsg);
  }, [notConnectedMsg]);

  // a previously failed post: surface why it failed when the editor opens
  const lastError = post?.lastError;
  useEffect(() => {
    if (lastError) toast.error(lastError);
  }, [lastError]);

  /** one bullet per network: will it get this post, and if not, why */
  const networkItems = (): ConfirmItem[] =>
    (['linkedin', 'instagram', 'facebook'] as const).map((p) => {
      const isConnected = p === 'facebook' ? !!user.facebook?.selectedPageId : !!user[p];
      const selected = platforms.includes(p);
      if (selected && isConnected) return { text: PLATFORM_LABEL[p], note: 'will be published', state: 'ok' as const };
      if (selected) {
        return {
          text: PLATFORM_LABEL[p],
          note: p === 'facebook' && user.facebook ? 'no Page chosen - it will fail' : 'not connected - it will fail',
          state: 'warn' as const,
        };
      }
      return {
        text: PLATFORM_LABEL[p],
        note: isConnected ? 'not selected, skipped' : 'not connected, skipped',
        state: 'off' as const,
      };
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (bulkDone) return; // this batch was already scheduled
    if (bulk) {
      if (days.length === 0) return toast.error('Add at least one photo.');
      const empty = days.findIndex((d) => d.images.length === 0);
      if (empty >= 0) return toast.error(`Day ${empty + 1} has no photos - add a photo or remove the day.`);
      const bad = bulkCheck(days.flatMap((d) => d.images.map((i) => i.file)));
      if (bad) return toast.error(bad);
      if (days.some((d) => d.images.length > maxImages))
        return toast.error(`A single post holds at most ${maxImages} images.`);
      if (duplicateDates(bulkDates).size > 0)
        return toast.error('Two days have the same date - give each post its own date.');
      if (days.some((_, k) => bulkSlot(k).getTime() <= Date.now())) return toast.error('Every post needs a future slot.');
      if (days.some((d) => d.caption.length > textLimit)) {
        return toast.error(`Text is limited to ${textLimit} characters.`);
      }
      const fmtDay = (d: Date) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
      const ok = await ask({
        title: `Schedule ${days.length} post${days.length === 1 ? '' : 's'}?`,
        items: [
          {
            text: days.length > 1 ? `${fmtDay(bulkDates[0])} to ${fmtDay(bulkDates[days.length - 1])}` : fmtDay(bulkDates[0]),
            note: `one post per day at ${SLOT_LABEL}`,
            state: 'ok',
          },
          ...networkItems(),
        ],
        confirmLabel: 'Schedule',
      });
      if (ok) save.mutate();
      return;
    }
    if (!instant && hour === '')
      return toast.error(`Today's ${SLOT_LABEL} has already passed - pick a later day or use Post now.`);
    if (toInstagram && keptMedia.length + files.length === 0)
      return toast.error('Instagram posts need an image or a video.');
    if (!instant && !slotFree(hour as number))
      return toast.error('That slot is already used on one of the selected platforms.');
    if (instant && !post) {
      const ok = await ask({
        title: 'Publish now?',
        items: [{ text: 'Goes live immediately', state: 'ok' }, ...networkItems()],
        confirmLabel: 'Publish',
      });
      if (!ok) return;
    }
    save.mutate();
  };
  const busy = save.isPending || del.isPending || postNow.isPending;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className={`modal card${bulk ? ' bulk' : ''}`} onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row modal-head">
          <h2 className="grow">
            {instant ? 'Post now' : bulk ? 'Plan posts' : post ? 'Edit post' : 'New post'}
          </h2>
          {post && <StatusBadge status={post.status} />}
          <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
        {(!post || !locked) && (
          <div>
            <div className="label">Post to</div>
            <div className="plat-checks" role="group" aria-label="Post to">
              {(['linkedin', 'instagram', 'facebook'] as const).map((p) => {
                const isConnected = connected.includes(p);
                const on = platforms.includes(p);
                // an already-saved post may target a network that was later disconnected: let it be unticked
                // a copy that is already published (or being published) can't be taken back
                const sent = group.some((g) => g.platform === p && (g.status === 'published' || g.status === 'publishing'));
                const disabled = sent || (!isConnected && !on);
                return (
                  <label key={p} className={`plat-check${on ? ' on' : ''}${disabled && !sent ? ' pending' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => togglePlatform(p)}
                    />
                    <span className="plat-text">
                      <span className="plat-name">{PLATFORM_LABEL[p]}</span>
                      {sent ? (
                        <span className="plat-status">Published</span>
                      ) : (
                        !isConnected && <span className="plat-status">Not connected</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {connected.length < 3 && (
              <p className="muted small">
                Not connected? <a className="link" href="/dashboard">Connect on the dashboard</a>.
              </p>
            )}
            {both && (
              <p className="muted small">
                One copy goes to each selected network.
              </p>
            )}
            {toInstagram && (
              <p className="muted small">
                Very tall or wide photos are automatically split into carousel panels to fit Instagram.
              </p>
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
          <div>
            <p className="small time-note">
              {hour === ''
                ? `Today's ${SLOT_LABEL} has passed - pick a later day or use Post now.`
                : `Publishes ${day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${SLOT_LABEL}.`}
            </p>
          </div>
        )}

        {!bulk && (
        <label>
          {toInstagram ? 'Caption' : 'Post text'}
          <textarea
            rows={8}
            maxLength={textLimit}
            disabled={locked || !!bulkDone}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What do you want to share?"
          />
          <span className="day-count muted small">
            {!locked && (
              <PasteButton
                onError={toast.error}
                onText={(t) => setContent((c) => (c ? `${c}
${t}` : t).slice(0, textLimit))}
              />
            )}
            {!locked && content && <ClearButton onClear={() => setContent('')} />}
            <span className="count-num">
              {content.length}/{textLimit}
            </span>
          </span>
        </label>
        )}

        {bulk ? (
          <div>
            <div className="label">Photos &amp; text · one post per day at {SLOT_LABEL}</div>
            <BulkPlanner
              days={days}
              setDays={setDays}
              start={bulkStart}
              timeLabel={SLOT_LABEL}
              maxPerDay={maxImages}
              maxDays={BULK_MAX_POSTS}
              maxTotal={BULK_MAX_PHOTOS}
              accept={toInstagram ? 'image/jpeg' : 'image/jpeg,image/png,image/gif'}
              textLimit={textLimit}
              disabled={!!bulkDone}
              check={bulkCheck}
              onError={toast.error}
            />
          </div>
        ) : (
        <div>
          <div className="label">Media</div>
          {keptMedia.length > 0 && visibleMedia.length === 0 && (
            <p className="muted small" style={{ margin: '0 0 0.45rem' }}>
              Media was removed from the server after publishing.
            </p>
          )}
          <div className="thumbs">
            {visibleMedia.map((m, mi) => (
              <div className="thumb" key={m.filename}>
                {m.kind === 'video' ? (
                  <video src={m.url} muted onClick={() => setPreviewIdx(mi)} />
                ) : (
                  <img src={m.url} alt="" onClick={() => setPreviewIdx(mi)} />
                )}
                {!locked && (
                  <button type="button" className="x" onClick={() => setRemoved((r) => [...r, m.filename])}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {previews.map(({ f, url }, i) => (
              <div className="thumb" key={url}>
                {f.type.startsWith('video/') ? (
                  <video src={url} muted onClick={() => setPreviewIdx(visibleMedia.length + i)} />
                ) : (
                  <img src={url} alt="" onClick={() => setPreviewIdx(visibleMedia.length + i)} />
                )}
                {!bulkDone && (
                  <button type="button" className="x" onClick={() => removeFile(i)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!locked && !bulkDone && !hasVideo && files.length < maxImages && (
              <label className="thumb add">
                +
                <input
                  type="file"
                  hidden
                  multiple
                  accept={
                    toInstagram
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
            {toInstagram
              ? `JPEG images (up to ${maxImages}, carousel) or one MP4 video (published as a Reel). Media is required by Instagram.`
              : 'JPG/PNG/GIF (up to 9) or one MP4 video.'}
          </div>
        </div>
        )}

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

        </div>

        <div className="row modal-foot">
          {post && !locked && (
            <>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={async () => {
                  const ok = await ask({
                    title: 'Delete this post?',
                    message:
                      group.length > 1
                        ? `It will be removed from all ${group.length} networks and will not be published.`
                        : 'It will be removed and will not be published.',
                    confirmLabel: 'Delete post',
                    danger: true,
                  });
                  if (ok) del.mutate();
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  const ok = await ask({
                    title: 'Publish right now?',
                    message: `This post will be published to ${group.map((p) => PLATFORM_LABEL[p.platform]).join(' + ')} immediately instead of waiting for its scheduled time.`,
                    confirmLabel: 'Publish now',
                  });
                  if (ok) postNow.mutate();
                }}
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
                ? save.isPending ? 'Publishing…' : 'Publish'
                : save.isPending
                  ? 'Saving…'
                  : bulkDone
                    ? 'Scheduled'
                    : post
                      ? 'Save changes'
                      : 'Schedule'}
            </button>
          )}
        </div>
        {confirmDialog}
        {previewIdx !== null && (
          <MediaPreview
            items={[
              ...visibleMedia.map((m) => ({ url: m.url, kind: m.kind })),
              ...previews.map(({ f, url }) => ({ url, kind: f.type.startsWith('video/') ? ('video' as const) : ('image' as const) })),
            ]}
            index={previewIdx}
            onIndex={setPreviewIdx}
            onClose={() => setPreviewIdx(null)}
          />
        )}
      </form>
    </div>
  );
}
