'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchStockRows, fetchCustomers, createSale,
} from '@/lib/data';
import { formatTaka, takaToPaisa, toBanglaDigits, paisaToTaka } from '@/lib/money';
import { isExpired, validateSaleQty } from '@/lib/business-rules';
import { L } from '@/lib/i18n/labels';
import type { StockRow, Customer } from '@/types/db';

interface CartLine {
  batch_id: string;
  medicine_id: string;
  name: string;
  unit: string;
  available: number;
  qty: number;
  unit_price_paisa: number;
}

export default function SalesPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountTaka, setDiscountTaka] = useState('0');
  const [paymentType, setPaymentType] = useState<'cash' | 'due' | 'mixed'>('cash');
  const [cashPaidTaka, setCashPaidTaka] = useState('0');
  const [customerId, setCustomerId] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [r, c] = await Promise.all([fetchStockRows(), fetchCustomers()]);
        setRows(r);
        setCustomers(c);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ');
      }
    })();
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return rows
      .filter(
        (r) =>
          r.qty_in_stock > 0 &&
          !isExpired(r.expiry_date) &&
          (`${r.name} ${r.strength ?? ''}`.toLowerCase().includes(s) ||
            (r.generic_name ?? '').toLowerCase().includes(s) ||
            (r.company ?? '').toLowerCase().includes(s)),
      )
      .slice(0, 12);
  }, [q, rows]);

  function addToCart(r: StockRow) {
    setErr('');
    setCart((prev) => {
      const found = prev.find((l) => l.batch_id === r.batch_id);
      if (found) {
        return prev.map((l) =>
          l.batch_id === r.batch_id
            ? { ...l, qty: Math.min(l.qty + 1, r.qty_in_stock) }
            : l,
        );
      }
      return [
        ...prev,
        {
          batch_id: r.batch_id,
          medicine_id: r.medicine_id,
          name: r.strength ? `${r.name} ${r.strength}` : r.name,
          unit: r.unit,
          available: r.qty_in_stock,
          qty: 1,
          unit_price_paisa: r.sale_price_paisa,
        },
      ];
    });
    setQ('');
  }

  function setQty(batch_id: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.batch_id === batch_id ? { ...l, qty } : l)));
  }

  /** এই বিক্রয়ের জন্য দাম বদলানো যায় (পয়সা সহ)। স্টকের দাম অপরিবর্তিত থাকে। */
  function setLinePrice(batch_id: string, taka: string) {
    setCart((prev) => prev.map((l) =>
      l.batch_id === batch_id ? { ...l, unit_price_paisa: Math.max(0, takaToPaisa(taka)) } : l));
  }

  function removeLine(batch_id: string) {
    setCart((prev) => prev.filter((l) => l.batch_id !== batch_id));
  }

  const subtotal = cart.reduce((a, l) => a + Math.round(l.unit_price_paisa * l.qty), 0);
  const discount = takaToPaisa(discountTaka);
  const total = Math.max(0, subtotal - discount);
  const cashPaid = paymentType === 'cash' ? total : paymentType === 'due' ? 0 : takaToPaisa(cashPaidTaka);
  const due = Math.max(0, total - cashPaid);

  async function submit() {
    setErr('');
    setMsg('');
    if (cart.length === 0) return setErr('অন্তত একটি ওষুধ যোগ করুন');
    for (const l of cart) {
      const v = validateSaleQty(l.qty, l.available);
      if (v) return setErr(`${l.name}: ${v}`);
    }
    if (paymentType !== 'cash' && !customerId) {
      return setErr('বাকি/মিশ্র বিক্রয়ে পাওনাদার নির্বাচন করুন');
    }
    setBusy(true);
    try {
      const res = await createSale({
        customer_id: paymentType === 'cash' ? null : customerId,
        discount_paisa: discount,
        payment_type: paymentType,
        cash_paid_paisa: cashPaid,
        items: cart.map((l) => ({
          medicine_id: l.medicine_id,
          batch_id: l.batch_id,
          qty: l.qty,
          unit_price_paisa: l.unit_price_paisa,
        })),
      });
      const queued = (res as { queued?: boolean })?.queued;
      setMsg(
        queued
          ? `বিক্রয় সংরক্ষিত (অফলাইন) — মোট ${formatTaka(total)}, বাকি ${formatTaka(due)}। ইন্টারনেট এলে সিঙ্ক হবে।`
          : `বিক্রয় সম্পন্ন — মোট ${formatTaka(total)}, নগদ ${formatTaka(cashPaid)}, বাকি ${formatTaka(due)}।`,
      );
      setCart([]);
      setDiscountTaka('0');
      setCashPaidTaka('0');
      setPaymentType('cash');
      setCustomerId('');
      const r = await fetchStockRows();
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'বিক্রয় ব্যর্থ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.sales}</h1>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* বাম: সার্চ ও ফলাফল */}
        <div className="card space-y-3">
          <input
            className="input"
            placeholder="ওষুধ / জেনেরিক / কোম্পানি দিয়ে খুঁজুন…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {results.map((r) => (
                <li key={r.batch_id}>
                  <button
                    className="flex w-full items-center justify-between px-1 py-3 text-left hover:bg-brand-light"
                    onClick={() => addToCart(r)}
                  >
                    <span>
                      <span className="font-semibold">{r.name}{r.strength ? ` ${r.strength}` : ''}</span>{' '}
                      <span className="text-sm text-gray-500">
                        {r.company ?? ''} · {r.generic_name ?? ''}
                      </span>
                      <br />
                      <span className="text-xs text-gray-400">
                        মেয়াদ {r.expiry_date ?? '—'} · স্টক {toBanglaDigits(r.qty_in_stock)} {L.unit[r.unit]}
                      </span>
                    </span>
                    <span className="font-bold text-brand">{formatTaka(r.sale_price_paisa)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q && results.length === 0 && (
            <p className="text-sm text-gray-400">কোনো বিক্রয়যোগ্য ওষুধ পাওয়া যায়নি</p>
          )}
        </div>

        {/* ডান: কার্ট ও পেমেন্ট */}
        <div className="card space-y-4">
          {cart.length === 0 ? (
            <p className="text-gray-400">ওষুধ যোগ করুন…</p>
          ) : (
            <ul className="space-y-2">
              {cart.map((l) => (
                <li key={l.batch_id} className="rounded-xl bg-gray-50 p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium">{l.name}</span>
                    <button className="text-danger px-2" onClick={() => removeLine(l.batch_id)}>✕</button>
                  </div>
                  <div className="mt-1 flex items-end gap-2">
                    <div className="w-24">
                      <label className="label mb-0 text-xs">দাম (৳)</label>
                      <input
                        type="number" inputMode="decimal" step="0.01" min={0}
                        className="input w-full py-2 text-center"
                        value={paisaToTaka(l.unit_price_paisa)}
                        onChange={(e) => setLinePrice(l.batch_id, e.target.value)}
                      />
                    </div>
                    <span className="pb-3 text-gray-400">×</span>
                    <div className="w-20">
                      <label className="label mb-0 text-xs">পরিমাণ</label>
                      <input
                        type="number" min={1} max={l.available}
                        className="input w-full py-2 text-center"
                        value={l.qty}
                        onChange={(e) => setQty(l.batch_id, Math.max(1, Number(e.target.value)))}
                      />
                    </div>
                    <span className="flex-1 pb-3 text-right text-sm font-semibold">
                      {formatTaka(l.unit_price_paisa * l.qty)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">ছাড় (৳)</label>
              <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={discountTaka}
                onChange={(e) => setDiscountTaka(e.target.value)} />
            </div>
            <div>
              <label className="label">পেমেন্ট</label>
              <select className="input" value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as typeof paymentType)}>
                <option value="cash">নগদ</option>
                <option value="due">বাকিতে</option>
                <option value="mixed">নগদ ও বাকি</option>
              </select>
            </div>
          </div>

          {paymentType !== 'cash' && (
            <div>
              <label className="label">পাওনাদার</label>
              <select className="input" value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— নির্বাচন করুন —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.village ? `(${c.village})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {paymentType === 'mixed' && (
            <div>
              <label className="label">নগদ প্রদান (৳)</label>
              <input className="input" type="number" inputMode="decimal" step="0.01" min={0} max={paisaToTaka(total)}
                value={cashPaidTaka} onChange={(e) => setCashPaidTaka(e.target.value)} />
            </div>
          )}

          <div className="rounded-xl bg-brand-light p-4">
            <Row label="উপমোট" value={formatTaka(subtotal)} />
            <Row label="ছাড়" value={formatTaka(discount)} />
            <Row label="মোট" value={formatTaka(total)} bold />
            <Row label="নগদ" value={formatTaka(cashPaid)} />
            <Row label="বাকি" value={formatTaka(due)} tone="alert" />
          </div>

          {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
          {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

          <button className="btn-primary w-full" disabled={busy || cart.length === 0} onClick={submit}>
            {busy ? L.common.loading : 'বিক্রয় সম্পন্ন করুন'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'alert' }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className={tone === 'alert' ? 'text-alert' : 'text-gray-600'}>{label}</span>
      <span className={`${bold ? 'text-lg font-bold text-brand-dark' : ''} ${tone === 'alert' ? 'text-alert' : ''}`}>
        {value}
      </span>
    </div>
  );
}
