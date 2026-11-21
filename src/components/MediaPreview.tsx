'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface PreviewItem {
  url: string;
  kind?: 'image' | 'video';
}

/**
 * Full-size preview of a post's photos / video. Self-contained: it only reads `items`, so it can be
 * dropped next to any thumbnail list. Esc closes it (without closing the modal underneath), arrows
 * move between items, and a click on the dark backdrop closes it.
 */
export function MediaPreview({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: PreviewItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = items.length;
  const item = items[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' && count > 1) {
        e.stopPropagation();
        onIndex((index + 1) % count);
      } else if (e.key === 'ArrowLeft' && count > 1) {
        e.stopPropagation();
        onIndex((index - 1 + count) % count);
      }
    };
    // capture phase: handled before anything else listening on the page
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, count, onIndex, onClose]);

  if (!item || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="media-preview"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      // stop here so the post modal's own overlay (which closes on mousedown) never sees it
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        className="media-preview-btn close"
        aria-label="Close preview"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
      >
        <X />
      </button>
      {count > 1 && (
        <button
          type="button"
          className="media-preview-btn prev"
          aria-label="Previous"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onIndex((index - 1 + count) % count)}
        >
          <ChevronLeft />
        </button>
      )}
      {item.kind === 'video' ? (
        <video
          key={item.url}
          className="media-preview-body"
          src={item.url}
          controls
          autoPlay
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={item.url}
          className="media-preview-body"
          src={item.url}
          alt=""
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {count > 1 && (
        <button
          type="button"
          className="media-preview-btn next"
          aria-label="Next"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onIndex((index + 1) % count)}
        >
          <ChevronRight />
        </button>
      )}
      {count > 1 && (
        <span className="media-preview-count">
          {index + 1} / {count}
        </span>
      )}
    </div>,
    document.body,
  );
}
