'use client';

import { useSyncExternalStore } from 'react';

/** Small toast store: works from React (useToasts) and from plain modules (the axios interceptor). */

export type ToastKind = 'error' | 'ok';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

/** how long a toast stays on screen */
const DURATION = 5200;
/** never stack more than this many at once */
const MAX = 4;

let items: ToastItem[] = [];
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function clearTimer(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export function dismissToast(id: number) {
  if (!items.some((t) => t.id === id)) return;
  clearTimer(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, text: string) {
  const msg = (text ?? '').trim();
  if (!msg) return;
  // the same message already on screen: restart its timer rather than stacking a duplicate
  const existing = items.find((t) => t.kind === kind && t.text === msg);
  if (existing) {
    clearTimer(existing.id);
    timers.set(
      existing.id,
      setTimeout(() => dismissToast(existing.id), DURATION),
    );
    return;
  }
  const id = ++seq;
  const next = [...items, { id, kind, text: msg }];
  const dropped = next.splice(0, Math.max(0, next.length - MAX));
  dropped.forEach((d) => clearTimer(d.id));
  items = next;
  timers.set(
    id,
    setTimeout(() => dismissToast(id), DURATION),
  );
  emit();
}

export const toast = {
  error: (text: string) => push('error', text),
  success: (text: string) => push('ok', text),
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}
