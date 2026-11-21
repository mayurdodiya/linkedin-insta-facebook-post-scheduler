'use client';

import { useState } from 'react';
import { ClearButton, PasteButton } from './PasteButton.tsx';
import { CalendarPlus, ImagePlus, Trash2 } from 'lucide-react';
import { MediaPreview } from './MediaPreview.tsx';

export interface BulkImage {
  id: string;
  file: File;
  url: string;
}
export interface BulkDay {
  id: string;
  images: BulkImage[];
  caption: string;
  /** manual date override (YYYY-MM-DD); empty = the day after the previous post */
  date?: string;
}

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const makeImage = (file: File): BulkImage => ({ id: uid('i'), file, url: URL.createObjectURL(file) });
export const makeDay = (images: BulkImage[] = []): BulkDay => ({ id: uid('d'), images, caption: '' });
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** Date of every day card: its own override, else the day after the previous card (the first starts at `start`). */
export function resolveDates(days: BulkDay[], start: Date): Date[] {
  const out: Date[] = [];
  days.forEach((d, k) => {
    const prev = out[k - 1];
    out.push(
      d.date
        ? fromYmd(d.date)
        : prev
          ? new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)
          : new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    );
  });
  return out;
}
/** keys of dates used by more than one card */
export const duplicateDates = (dates: Date[]) => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  dates.forEach((d) => (seen.has(ymd(d)) ? dup.add(ymd(d)) : seen.add(ymd(d))));
  return dup;
};

export const revokeImages = (days: BulkDay[]) => days.forEach((d) => d.images.forEach((i) => URL.revokeObjectURL(i.url)));

interface Props {
  days: BulkDay[];
  setDays: (updater: (days: BulkDay[]) => BulkDay[]) => void;
  /** date of the first day; day k is start + k days */
  start: Date;
  timeLabel: string;
  maxPerDay: number;
  maxDays: number;
  maxTotal: number;
  accept: string;
  textLimit: number;
  disabled?: boolean;
  /** returns an error message when the files are not allowed */
  check: (files: File[]) => string;
  onError: (msg: string) => void;
}

/**
 * One card per day. Photos can be dragged between days (merge into a day) or onto the dashed
 * strip between days (split out into a new day). Days that lose their last photo disappear and the
 * dates after them move up, so the schedule always stays one post per consecutive day.
 */
export function BulkPlanner({
  days,
  setDays,
  start,
  timeLabel,
  maxPerDay,
  maxDays,
  maxTotal,
  accept,
  textLimit,
  disabled,
  check,
  onError,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // photo being previewed full-size: which day, which photo within it
  const [preview, setPreview] = useState<{ dayId: string; index: number } | null>(null);
  const total = days.reduce((n, d) => n + d.images.length, 0);

  const dates = resolveDates(days, start);
  const dup = duplicateDates(dates);
  const setDate = (id: string, date?: string) =>
    setDays((ds) => ds.map((d) => (d.id === id ? { ...d, date: date || undefined } : d)));

  /** add files: each one becomes its own new day, or all go into `intoDay` */
  function add(list: FileList | null, intoDay?: string) {
    if (!list || disabled) return;
    const incoming = Array.from(list);
    const bad = check(incoming);
    if (bad) return onError(bad);
    if (total + incoming.length > maxTotal) return onError(`You can upload up to ${maxTotal} photos at once.`);
    if (intoDay) {
      const day = days.find((d) => d.id === intoDay);
      if (day && day.images.length + incoming.length > maxPerDay) {
        return onError(`A single post holds at most ${maxPerDay} images.`);
      }
      onError('');
      setDays((ds) => ds.map((d) => (d.id === intoDay ? { ...d, images: [...d.images, ...incoming.map(makeImage)] } : d)));
      return;
    }
    if (days.length + incoming.length > maxDays) return onError(`You can plan up to ${maxDays} days at once.`);
    onError('');
    setDays((ds) => [...ds, ...incoming.map((f) => makeDay([makeImage(f)]))]);
  }

  function addDay() {
    if (disabled) return;
    if (days.length >= maxDays) return onError(`You can plan up to ${maxDays} days at once.`);
    onError('');
    setDays((ds) => [...ds, makeDay()]);
  }

  function removeDay(id: string) {
    if (disabled) return;
    setDays((ds) => {
      const gone = ds.find((d) => d.id === id);
      if (gone) revokeImages([gone]);
      return ds.filter((d) => d.id !== id);
    });
  }

  function removeImage(dayId: string, imgId: string) {
    if (disabled) return;
    setDays((ds) =>
      ds.flatMap((d) => {
        if (d.id !== dayId) return [d];
        const img = d.images.find((i) => i.id === imgId);
        if (img) URL.revokeObjectURL(img.url);
        const images = d.images.filter((i) => i.id !== imgId);
        return images.length ? [{ ...d, images }] : [];
      }),
    );
  }

  /** move a photo into an existing day (`toDay`) or into a new day inserted at index `insertAt` */
  function move(imgId: string, target: { toDay: string } | { insertAt: number }) {
    const srcIdx = days.findIndex((d) => d.images.some((i) => i.id === imgId));
    if (srcIdx < 0) return;
    const src = days[srcIdx];
    const img = src.images.find((i) => i.id === imgId)!;
    if ('toDay' in target) {
      if (target.toDay === src.id) return;
      const dest = days.find((d) => d.id === target.toDay);
      if (!dest) return;
      if (dest.images.length >= maxPerDay) return onError(`A single post holds at most ${maxPerDay} images.`);
      onError('');
      setDays((ds) =>
        ds.flatMap((d) => {
          if (d.id === dest.id) return [{ ...d, images: [...d.images, img] }];
          if (d.id === src.id) {
            const images = d.images.filter((i) => i.id !== imgId);
            return images.length ? [{ ...d, images }] : [];
          }
          return [d];
        }),
      );
      return;
    }
    const at = target.insertAt;
    // a lone photo dropped next to its own day would just recreate that same day
    if (src.images.length === 1 && (at === srcIdx || at === srcIdx + 1)) return;
    if (src.images.length > 1 && days.length >= maxDays) return onError(`You can plan up to ${maxDays} days at once.`);
    onError('');
    setDays((ds) => {
      const emptied = src.images.length === 1;
      const rest = ds.flatMap((d) => {
        if (d.id !== src.id) return [d];
        const images = d.images.filter((i) => i.id !== imgId);
        return images.length ? [{ ...d, images }] : [];
      });
      const pos = emptied && srcIdx < at ? at - 1 : at;
      rest.splice(pos, 0, makeDay([img]));
      return rest;
    });
  }

  const dragging = dragId !== null;
  const dropProps = (key: string, onDrop: (id: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragId;
      setOver(null);
      setDragId(null);
      if (id) onDrop(id);
    },
  });

  const previewImages = preview
    ? days.find((d) => d.id === preview.dayId)?.images.map((i) => ({ url: i.url, kind: 'image' as const }))
    : undefined;

  const gap = (at: number) => (
    <div
      key={`gap${at}`}
      className={`day-gap${dragging ? ' live' : ''}${over === `gap${at}` ? ' over' : ''}`}
      {...dropProps(`gap${at}`, (id) => move(id, { insertAt: at }))}
    >
      {dragging && <span>Drop here to post on its own day</span>}
    </div>
  );

  return (
    <div className="bulk-days">
      {days.length > 0 && (
        <p className="muted small bulk-hint">
          {total} photo{total === 1 ? '' : 's'} · {days.length} post{days.length === 1 ? '' : 's'} · drag photos between days to group or split them.
        </p>
      )}

      {days.length > 0 && gap(0)}
      {days.map((day, k) => (
        <div key={day.id}>
          <div className={`day-card${over === day.id ? ' over' : ''}`} {...dropProps(day.id, (id) => move(id, { toDay: day.id }))}>
            <div className="day-head">
              <span className="day-num">{k + 1}</span>
              <div className="day-info">
                <div className="day-line">
                  <input
                    type="date"
                    className="day-date"
                    aria-label={`Date for day ${k + 1}`}
                    min={ymd(start)}
                    value={ymd(dates[k])}
                    disabled={disabled}
                    onChange={(e) => e.target.value && setDate(day.id, e.target.value)}
                  />
                  {day.date && !disabled && (
                    <button type="button" className="day-auto" onClick={() => setDate(day.id)} title="Follow the previous day again">
                      Reset date
                    </button>
                  )}
                </div>
                <span className="day-sub">
                  {dates[k].toLocaleDateString([], { weekday: 'long' })} · {timeLabel} · {day.images.length} photo
                  {day.images.length === 1 ? '' : 's'}
                </span>
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="day-remove"
                  onClick={() => removeDay(day.id)}
                  aria-label={`Remove day ${k + 1}`}
                  title="Remove this day"
                >
                  <Trash2 />
                </button>
              )}
            </div>
            {dup.has(ymd(dates[k])) && <p className="day-warn small">Another post is already on this date - pick a different one.</p>}
            <div className="day-body">
              <div className="day-label">Photos</div>
            <div className="thumbs">
              {day.images.map((img, imgIdx) => (
                <div
                  className={`thumb draggable${dragId === img.id ? ' dragging' : ''}`}
                  key={img.id}
                  draggable={!disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', img.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(img.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  title="Click to preview · drag to another day"
                >
                  <img src={img.url} alt="" draggable={false} onClick={() => setPreview({ dayId: day.id, index: imgIdx })} />
                  {!disabled && (
                    <button type="button" className="x" onClick={() => removeImage(day.id, img.id)} aria-label="Remove photo">
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!disabled && day.images.length < maxPerDay && (
                <label className="thumb add" title="Add more photos to this day">
                  +
                  <input
                    type="file"
                    hidden
                    multiple
                    accept={accept}
                    onChange={(e) => {
                      add(e.target.files, day.id);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
            <div className="day-label">Post text</div>
            <textarea
              className="day-text"
              rows={2}
              maxLength={textLimit}
              disabled={disabled}
              value={day.caption}
              onChange={(e) => {
                const caption = e.target.value;
                setDays((ds) => ds.map((d) => (d.id === day.id ? { ...d, caption } : d)));
              }}
              placeholder="Post text (optional)"
            />
            <div className="day-count muted small">
              {!disabled && (
                <PasteButton
                  onError={onError}
                  onText={(t) =>
                    setDays((ds) =>
                      ds.map((d) =>
                        d.id === day.id ? { ...d, caption: (d.caption ? `${d.caption}
${t}` : t).slice(0, textLimit) } : d,
                      ),
                    )
                  }
                />
              )}
              {!disabled && day.caption && (
                <ClearButton
                  onClear={() => setDays((ds) => ds.map((d) => (d.id === day.id ? { ...d, caption: '' } : d)))}
                />
              )}
              <span className="count-num">
                {day.caption.length}/{textLimit}
              </span>
            </div>
            </div>
          </div>
          {gap(k + 1)}
        </div>
      ))}

      {!disabled && (
        <div className={`bulk-actions${days.length === 0 ? ' no-days' : ''}`}>
          {total < maxTotal && days.length < maxDays && (
            <label className="bulk-tile">
              <ImagePlus />
              <span>Add photos</span>
              <input
                type="file"
                hidden
                multiple
                accept={accept}
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {days.length < maxDays && (
            <button type="button" className="bulk-tile" onClick={addDay}>
              <CalendarPlus />
              <span>Add day</span>
            </button>
          )}
        </div>
      )}
      {previewImages && preview && previewImages[preview.index] && (
        <MediaPreview
          items={previewImages}
          index={preview.index}
          onIndex={(i) => setPreview({ dayId: preview.dayId, index: i })}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
