'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckCircleIcon, CloseIcon } from './Icons.tsx';
import { dismissToast, useToasts } from '../toast.tsx';

/** Renders the toast stack above everything (including modals). Mount once, near the app root. */
export function ToastViewport() {
  const items = useToasts();
  const [ready, setReady] = useState(false);
  // portals need document, which does not exist during SSR
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return createPortal(
    <div className="toast-stack" role="region" aria-label="Notifications">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon">{t.kind === 'error' ? <AlertIcon /> : <CheckCircleIcon />}</span>
          <span className="toast-text">{t.text}</span>
          <button
            type="button"
            className="toast-x"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(t.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
