'use client';

import { useState } from 'react';
import { ClipboardPaste, Eraser } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog.tsx';

/** Clears a text box after the user confirms in a dialog. */
export function ClearButton({ onClear, disabled }: { onClear: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="paste-btn" disabled={disabled} onClick={() => setOpen(true)}>
        <Eraser />
        Clear
      </button>
      {open && (
        <ConfirmDialog
          title="Clear this text?"
          message="The text you wrote for this post will be removed. This can't be undone."
          confirmLabel="Clear text"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            onClear();
          }}
        />
      )}
    </>
  );
}

/** One-tap paste from the clipboard (handy on phones, where long-press paste is fiddly). */
export function PasteButton({
  onText,
  onError,
  disabled,
}: {
  onText: (text: string) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
}) {
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return onError?.('The clipboard is empty - copy some text first.');
      onError?.('');
      onText(text);
    } catch {
      onError?.('The browser blocked clipboard access - long-press the text box and choose Paste instead.');
    }
  }
  return (
    <button type="button" className="paste-btn" disabled={disabled} onClick={() => void paste()}>
      <ClipboardPaste />
      Paste
    </button>
  );
}
