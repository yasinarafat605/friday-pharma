'use client';

import { useEffect, useState } from 'react';
import { isScanSupported, scanMedicinePack, type ScanResult } from '@/lib/scan/ocr';
import { matchMedicines, type ParsedLabel } from '@/lib/scan/parse';
import { L } from '@/lib/i18n/labels';
import type { Medicine } from '@/types/db';

/**
 * ওষুধের পাতা স্ক্যান করে নাম, পাওয়ার ও জেনেরিক বসানোর প্যানেল।
 * শুধু Android অ্যাপে দেখা যায়। দাম কখনো স্ক্যান হয় না, সবসময় হাতে দিতে হয়।
 */
export function ScanPanel({
  medicines, onUseParsed, onUseExisting, onError,
}: {
  medicines: Medicine[];
  onUseParsed: (parsed: ParsedLabel) => void;
  onUseExisting: (medicineId: string) => void;
  onError: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [form, setForm] = useState({ name: '', strength: '', generic: '' });
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => { void isScanSupported().then(setSupported); }, []);

  if (!supported) return null;

  const matches = result
    ? matchMedicines(
      { name: form.name, strength: form.strength || null, generic: form.generic || null },
      medicines,
    )
    : [];

  async function scan() {
    setBusy(true);
    onError('');
    try {
      const r = await scanMedicinePack();
      if (!r) return; // বাতিল করা হয়েছে
      setResult(r);
      setForm({
        name: r.parsed.name,
        strength: r.parsed.strength ?? '',
        generic: r.parsed.generic ?? '',
      });
      setShowRaw(false);
      if (!r.parsed.name && r.lines.length === 0) {
        onError('কোনো লেখা পড়া যায়নি — আলো বাড়িয়ে বা পাতা সোজা করে আবার চেষ্টা করুন');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'স্ক্যান ব্যর্থ');
    } finally { setBusy(false); }
  }

  function useParsed() {
    onUseParsed({
      ...(result?.parsed ?? { type: null, company: null, candidates: [] }),
      name: form.name.trim(),
      strength: form.strength.trim() || null,
      generic: form.generic.trim() || null,
    } as ParsedLabel);
    setResult(null);
  }

  return (
    <div className="card space-y-3 border-brand/30 bg-brand-light">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl">📷</span>
        <div className="flex-1">
          <h2 className="font-bold text-brand-dark">পাতা স্ক্যান করুন</h2>
          <p className="text-xs text-gray-600">
            ওষুধের পাতার ছবি তুললে নাম, পাওয়ার ও জেনেরিক নিজে থেকে বসবে। দাম আপনাকে দিতে হবে।
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={scan}>
          {busy ? 'পড়া হচ্ছে…' : 'স্ক্যান'}
        </button>
      </div>

      {result && (
        <div className="space-y-3 rounded-xl bg-white p-3">
          <p className="text-sm font-semibold text-brand-dark">যা পড়া গেছে — যাচাই করে ঠিক করুন</p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">নাম</label>
              <input className="input" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">পাওয়ার</label>
              <input className="input" value={form.strength}
                onChange={(e) => setForm({ ...form, strength: e.target.value })} />
            </div>
            <div>
              <label className="label">জেনেরিক</label>
              <input className="input" value={form.generic}
                onChange={(e) => setForm({ ...form, generic: e.target.value })} />
            </div>
          </div>

          {result.parsed.candidates.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-gray-600">নাম ভুল হলে এখান থেকে বেছে নিন:</p>
              <div className="flex flex-wrap gap-2">
                {result.parsed.candidates.map((c) => (
                  <button key={c} type="button"
                    className="badge bg-gray-100 text-gray-700"
                    onClick={() => setForm({ ...form, name: c })}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {matches.length > 0 && (
            <div className="rounded-xl bg-success/5 p-3">
              <p className="mb-2 text-sm font-semibold text-success">
                এই ওষুধ আগে থেকেই তালিকায় আছে
              </p>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li key={m.medicine.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {m.medicine.name}{m.medicine.strength ? ` ${m.medicine.strength}` : ''}
                      <span className="block text-xs text-gray-500">
                        {[m.medicine.generic_name, m.medicine.company].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <button type="button" className="btn-outline px-4 py-2 text-sm"
                      onClick={() => { onUseExisting(m.medicine.id); setResult(null); }}>
                      এটিই নির্বাচন করুন
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" onClick={useParsed}>
              নতুন ওষুধ হিসেবে ব্যবহার করুন
            </button>
            <button type="button" className="btn-outline" onClick={() => setResult(null)}>
              {L.common.cancel}
            </button>
            <button type="button" className="text-sm text-gray-500 underline"
              onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'পড়া লেখা লুকান' : 'পড়া সব লেখা দেখুন'}
            </button>
          </div>

          {showRaw && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">
              {result.lines.join('\n') || 'কিছু পড়া যায়নি'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
