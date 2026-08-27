'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchCustomers, recordDuePayment } from '@/lib/data';
import { formatTaka, takaToPaisa, paisaToTaka } from '@/lib/money';
import { validateDuePayment } from '@/lib/business-rules';
import { L } from '@/lib/i18n/labels';
import type { Customer, PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'bkash', 'nagad', 'rocket', 'other'];

export default function DueCollectionPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [amountTaka, setAmountTaka] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { setCustomers(await fetchCustomers()); }
  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!selected) return setErr('পাওনাদার নির্বাচন করুন');
    const amount = takaToPaisa(amountTaka);
    const v = validateDuePayment(amount, selected.current_due_paisa);
    if (v) return setErr(v);
    setBusy(true);
    try {
      const res = await recordDuePayment({
        customer_id: customerId, amount_paisa: amount, method, pay_date: payDate,
      });
      const queued = (res as { queued?: boolean })?.queued;
      setMsg(queued ? 'আদায় সংরক্ষিত (অফলাইন)' : `আদায় সম্পন্ন — ${formatTaka(amount)}`);
      setAmountTaka('');
      await load();
      setCustomerId('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally { setBusy(false); }
  }

  const dueCustomers = customers.filter((c) => c.current_due_paisa > 0);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.dueCollection}</h1>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="label">পাওনাদার</label>
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— নির্বাচন করুন —</option>
            {dueCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.village ? `(${c.village})` : ''} — বাকি {formatTaka(c.current_due_paisa)}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="rounded-xl bg-brand-light p-3 text-center">
            বর্তমান বাকি: <span className="text-xl font-bold text-alert">{formatTaka(selected.current_due_paisa)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">পরিশোধের পরিমাণ (৳)</label>
            <input className="input" type="number" min={0}
              max={selected ? paisaToTaka(selected.current_due_paisa) : undefined}
              value={amountTaka} onChange={(e) => setAmountTaka(e.target.value)} /></div>
          <div><label className="label">তারিখ</label>
            <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">মাধ্যম</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{L.paymentMethod[m]}</option>)}
          </select>
        </div>

        {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

        <button className="btn-primary w-full" disabled={busy}>{busy ? L.common.loading : 'আদায় রেকর্ড করুন'}</button>
      </form>
    </div>
  );
}
