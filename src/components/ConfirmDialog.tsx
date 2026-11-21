'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, TriangleAlert } from 'lucide-react';

/** One bullet in a confirm dialog: ok = will happen, warn = problem, off = will not happen. */
export interface ConfirmItem {
  text: string;
  note?: string;
  state: 'ok' | 'warn' | 'off';
}

/** Small in-app confirmation dialog (rendered above everything, including the composer popup). */
export function ConfirmDialog({
  title,
  message,
  items,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  items?: ConfirmItem[];
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  // a portal still bubbles React events to the composer overlay, which closes on mouse-down
  return createPortal(
    <div className="confirm-overlay" role="presentation" onMouseDown={(e) => { e.stopPropagation(); onCancel(); }}>
      <div
        className="confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        {message && <p>{message}</p>}
        {items && items.length > 0 && (
          <ul className="confirm-list">
            {items.map((it, i) => (
              <li key={i} className={`confirm-item ${it.state}`}>
                <span className="ci-icon">
                  {it.state === 'ok' ? <Check /> : it.state === 'warn' ? <TriangleAlert /> : <Minus />}
                </span>
                <span>
                  <b>{it.text}</b>
                  {it.note && <span className="ci-note"> - {it.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'danger solid' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}


export interface ConfirmOptions {
  title: string;
  message?: string;
  items?: ConfirmItem[];
  confirmLabel?: string;
  danger?: boolean;
}

/** Promise-style replacement for window.confirm: `if (await ask({...})) doIt()`. Render `dialog` once. */
export function useConfirm(): { ask: (o: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<{ opts: ConfirmOptions; done: (ok: boolean) => void } | null>(null);
  const ask = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, done: resolve })),
    [],
  );
  const finish = (ok: boolean) => {
    state?.done(ok);
    setState(null);
  };
  const dialog = state ? (
    <ConfirmDialog
      title={state.opts.title}
      message={state.opts.message}
      items={state.opts.items}
      confirmLabel={state.opts.confirmLabel ?? 'Confirm'}
      danger={state.opts.danger}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null;
  return { ask, dialog };
}
