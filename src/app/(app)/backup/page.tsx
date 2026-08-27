'use client';

import { useState } from 'react';
import { exportAll, importAll, countRecords, type BackupDump } from '@/lib/db/local';
import { L } from '@/lib/i18n/labels';

// এনক্রিপ্টেড local backup/restore (Web Crypto AES-GCM, PBKDF2 key)।
// ফাইল = salt(16) + iv(12) + ciphertext।
async function deriveKey(passphrase: string, salt: BufferSource) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encryptDump(dump: BackupDump, pass: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const data = new TextEncoder().encode(JSON.stringify(dump));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(salt.length + iv.length + cipher.length);
  out.set(salt, 0); out.set(iv, salt.length); out.set(cipher, salt.length + iv.length);
  return new Blob([out], { type: 'application/octet-stream' });
}

async function decryptFile(file: File, pass: string): Promise<BackupDump> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const salt = buf.slice(0, 16);
  const iv = buf.slice(16, 28);
  const cipher = buf.slice(28);
  const key = await deriveKey(pass, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain)) as BackupDump;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function BackupPage() {
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // restore state
  const [rPass, setRPass] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ dump: BackupDump; counts: Record<string, number> } | null>(null);
  const [rErr, setRErr] = useState('');

  async function doExport() {
    setMsg('');
    if (pass.length < 4) { setMsg('অন্তত ৪ অক্ষরের পাসফ্রেজ দিন'); return; }
    setBusy(true);
    try {
      const blob = await encryptDump(await exportAll(), pass);
      download(blob, `asshifa-backup-${new Date().toISOString().slice(0, 10)}.enc`);
      setMsg('এনক্রিপ্টেড ব্যাকআপ ডাউনলোড হয়েছে — USB/নিরাপদ ফোল্ডারে রাখুন।');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'ব্যাকআপ ব্যর্থ');
    } finally { setBusy(false); }
  }

  async function loadPreview() {
    setRErr(''); setPreview(null);
    if (!file) { setRErr('ফাইল নির্বাচন করুন'); return; }
    if (rPass.length < 4) { setRErr('পাসফ্রেজ দিন'); return; }
    setBusy(true);
    try {
      const dump = await decryptFile(file, rPass); // decrypt সফল = corruption/পাসফ্রেজ ঠিক
      setPreview({ dump, counts: countRecords(dump) });
    } catch {
      setRErr('পাসফ্রেজ ভুল অথবা ফাইল নষ্ট');
    } finally { setBusy(false); }
  }

  async function confirmRestore() {
    if (!preview) return;
    setBusy(true); setRErr('');
    try {
      // Restore-এর আগে বর্তমান ডেটার safety backup
      const safety = await encryptDump(await exportAll(), rPass);
      download(safety, `asshifa-SAFETY-before-restore-${Date.now()}.enc`);
      await importAll(preview.dump);
      setMsg('Restore সম্পন্ন — অ্যাপ রিলোড হচ্ছে');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setRErr(e instanceof Error ? e.message : 'Restore ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.backup}</h1>

      {/* Export */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">এনক্রিপ্টেড ব্যাকআপ নিন</h2>
        <p className="text-sm text-gray-600">
          সব ডেটার এনক্রিপ্টেড কপি। পাসফ্রেজ ছাড়া খোলা যাবে না। নিয়মিত (সপ্তাহে অন্তত একবার) নিন।
        </p>
        <div>
          <label className="label">ব্যাকআপ পাসফ্রেজ</label>
          <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder="মনে রাখুন — এটি ছাড়া restore হবে না" />
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={doExport}>
          {busy ? L.common.loading : 'এনক্রিপ্টেড ব্যাকআপ ডাউনলোড'}
        </button>
        {msg && <p className="rounded bg-brand-light px-3 py-2 text-brand-dark">{msg}</p>}
      </div>

      {/* Restore */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">ব্যাকআপ থেকে Restore</h2>
        <p className="text-sm text-alert">
          সতর্কতা: Restore করলে বর্তমান ডেটা প্রতিস্থাপিত হবে। আগে স্বয়ংক্রিয়ভাবে একটি safety backup নামবে।
        </p>
        <input type="file" accept=".enc" className="input"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        <div>
          <label className="label">ফাইলের পাসফ্রেজ</label>
          <input className="input" type="password" value={rPass} onChange={(e) => setRPass(e.target.value)} />
        </div>
        {rErr && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{rErr}</p>}

        {!preview ? (
          <button className="btn-outline w-full" disabled={busy} onClick={loadPreview}>
            যাচাই করুন ও preview দেখুন
          </button>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <p className="mb-1 font-semibold">Preview — যা restore হবে:</p>
              <ul className="grid grid-cols-2 gap-x-4">
                {Object.entries(preview.counts).map(([k, n]) => (
                  <li key={k} className="flex justify-between"><span>{k}</span><span>{n}</span></li>
                ))}
              </ul>
            </div>
            <button className="btn-danger w-full" disabled={busy} onClick={confirmRestore}>
              {busy ? L.common.loading : 'নিশ্চিত করে Restore করুন'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
