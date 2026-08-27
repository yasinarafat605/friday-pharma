'use client';

import { useState } from 'react';

/**
 * আর্থিক রেকর্ড বাতিলের বাটন। কারণ ছাড়া বাতিল হয় না।
 * রেকর্ড মুছে যায় না — "বাতিল" চিহ্ন নিয়ে তালিকায় থাকে ও হিসাব উল্টে যায়।
 */
export function CancelButton({
  label = 'বাতিল',
  confirmText,
  disabled,
  onCancel,
  onError,
  onDone,
}: {
  label?: string;
  confirmText: string;
  disabled?: boolean;
  onCancel: (reason: string) => Promise<void>;
  onError: (text: string) => void;
  onDone: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    const reason = window.prompt(`${confirmText}\n\nবাতিলের কারণ লিখুন:`);
    if (reason === null) return;
    if (!reason.trim()) { onError('বাতিলের কারণ লিখুন'); return; }
    setBusy(true);
    try {
      await onCancel(reason.trim());
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'বাতিল ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <button
      type="button"
      className="rounded-lg border border-danger px-3 py-1 text-sm font-semibold text-danger disabled:opacity-40"
      disabled={disabled || busy}
      onClick={run}
    >
      {busy ? '…' : label}
    </button>
  );
}

/** বাতিল হওয়া রেকর্ডের চিহ্ন। */
export function StatusBadge({ status }: { status?: string }) {
  const cancelled = status === 'cancelled';
  return (
    <span className={cancelled ? 'badge badge-danger' : 'badge badge-normal'}>
      {cancelled ? 'বাতিল' : 'সক্রিয়'}
    </span>
  );
}
