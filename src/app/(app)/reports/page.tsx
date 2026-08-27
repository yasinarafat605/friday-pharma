'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchDailyReport, fetchMonthlyReport, fetchInventoryReport,
  type DailyReport, type MonthlyReport, type InventoryReport,
} from '@/lib/data';
import { formatTaka, toBanglaDigits } from '@/lib/money';
import { toCSV, downloadCSV } from '@/lib/csv';
import { L } from '@/lib/i18n/labels';

type Tab = 'daily' | 'monthly' | 'inventory';

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.reports}</h1>
      <p className="text-sm text-gray-500">রিপোর্ট শুধু হিসাবের জন্য — CSV export ব্যাকআপ, invoice/bill নয়।</p>

      <div className="flex gap-2">
        {([['daily', 'দৈনিক'], ['monthly', 'মাসিক'], ['inventory', 'ইনভেন্টরি']] as const).map(([k, lbl]) => (
          <button key={k} className={`badge ${tab === k ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === 'daily' && <Daily />}
      {tab === 'monthly' && <Monthly />}
      {tab === 'inventory' && <Inventory />}
    </div>
  );
}

function LineRow({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'alert' }) {
  const c = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger'
    : tone === 'alert' ? 'text-alert' : 'text-brand-dark';
  return (
    <div className="flex justify-between border-b border-gray-100 py-2">
      <span className="text-gray-600">{label}</span>
      <span className={`font-semibold ${c}`}>{value}</span>
    </div>
  );
}

function Daily() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [r, setR] = useState<DailyReport | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setR(await fetchDailyReport(date)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  function exportCSV() {
    if (!r) return;
    const csv = toCSV(['বিবরণ', 'টাকা'], [
      ['মোট বিক্রয়', formatTaka(r.total_sales_paisa, { symbol: false })],
      ['নগদ বিক্রয়', formatTaka(r.cash_sales_paisa, { symbol: false })],
      ['বাকিতে বিক্রয়', formatTaka(r.due_sales_paisa, { symbol: false })],
      ['বাকি আদায়', formatTaka(r.collection_paisa, { symbol: false })],
      ['মোট খরচ', formatTaka(r.expense_paisa, { symbol: false })],
      ['Gross profit', formatTaka(r.gross_profit_paisa, { symbol: false })],
      ['Net profit', formatTaka(r.net_profit_paisa, { symbol: false })],
      ['স্টক ক্রয়', formatTaka(r.stock_purchase_paisa, { symbol: false })],
    ]);
    downloadCSV(`daily-report-${date}.csv`, csv);
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-outline px-3 py-2 text-sm" onClick={exportCSV} disabled={!r}>CSV</button>
      </div>
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      {r && (
        <div>
          <LineRow label="মোট বিক্রয়" value={formatTaka(r.total_sales_paisa)} />
          <LineRow label="নগদ বিক্রয়" value={formatTaka(r.cash_sales_paisa)} tone="success" />
          <LineRow label="বাকিতে বিক্রয়" value={formatTaka(r.due_sales_paisa)} tone="alert" />
          <LineRow label="বাকি আদায়" value={formatTaka(r.collection_paisa)} tone="success" />
          <LineRow label="মোট খরচ" value={formatTaka(r.expense_paisa)} tone="danger" />
          <LineRow label="Gross profit" value={formatTaka(r.gross_profit_paisa)} />
          <LineRow label="আনুমানিক Net profit" value={formatTaka(r.net_profit_paisa)}
            tone={r.net_profit_paisa >= 0 ? 'success' : 'danger'} />
          <LineRow label="স্টক ক্রয়" value={formatTaka(r.stock_purchase_paisa)} />
        </div>
      )}
    </div>
  );
}

function Monthly() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [r, setR] = useState<MonthlyReport | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setR(await fetchMonthlyReport(year, month)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, [year, month]);
  useEffect(() => { void load(); }, [load]);

  function exportCSV() {
    if (!r) return;
    const rows: [string, string][] = [
      ['মোট বিক্রয়', formatTaka(r.total_sales_paisa, { symbol: false })],
      ['ক্রয়মূল্য', formatTaka(r.purchase_cost_paisa, { symbol: false })],
      ['Gross profit', formatTaka(r.gross_profit_paisa, { symbol: false })],
      ['মোট খরচ', formatTaka(r.total_expense_paisa, { symbol: false })],
      ['Net profit', formatTaka(r.net_profit_paisa, { symbol: false })],
      ['নতুন বাকি', formatTaka(r.new_due_paisa, { symbol: false })],
      ['আদায় করা বাকি', formatTaka(r.collected_due_paisa, { symbol: false })],
      ['বর্তমান মোট পাওনা', formatTaka(r.current_total_due_paisa, { symbol: false })],
    ];
    for (const [cat, amt] of Object.entries(r.expense_by_category || {})) {
      rows.push([`খরচ: ${cat}`, formatTaka(amt, { symbol: false })]);
    }
    downloadCSV(`monthly-report-${year}-${month}.csv`, toCSV(['বিবরণ', 'টাকা'], rows));
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{toBanglaDigits(m)} মাস</option>
          ))}
        </select>
        <input className="input w-28" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <button className="btn-outline ml-auto px-3 py-2 text-sm" onClick={exportCSV} disabled={!r}>CSV</button>
      </div>
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      {r && (
        <div>
          <LineRow label="মাসের মোট বিক্রয়" value={formatTaka(r.total_sales_paisa)} />
          <LineRow label="মোট ক্রয়মূল্য" value={formatTaka(r.purchase_cost_paisa)} />
          <LineRow label="Gross profit" value={formatTaka(r.gross_profit_paisa)} />
          <LineRow label="মোট খরচ" value={formatTaka(r.total_expense_paisa)} tone="danger" />
          <LineRow label="Net profit" value={formatTaka(r.net_profit_paisa)}
            tone={r.net_profit_paisa >= 0 ? 'success' : 'danger'} />
          <LineRow label="নতুন বাকি" value={formatTaka(r.new_due_paisa)} tone="alert" />
          <LineRow label="আদায় করা বাকি" value={formatTaka(r.collected_due_paisa)} tone="success" />
          <LineRow label="বর্তমান মোট পাওনা" value={formatTaka(r.current_total_due_paisa)} tone="alert" />
          {Object.keys(r.expense_by_category || {}).length > 0 && (
            <div className="mt-3">
              <p className="mb-1 font-semibold text-brand-dark">খরচের ভাঙ্গা হিসাব</p>
              {Object.entries(r.expense_by_category).map(([cat, amt]) => (
                <LineRow key={cat} label={cat} value={formatTaka(amt)} tone="danger" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Inventory() {
  const [r, setR] = useState<InventoryReport | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try { setR(await fetchInventoryReport()); }
      catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
    })();
  }, []);

  function exportCSV() {
    if (!r) return;
    const rows = r.rows.map((x) => [
      x.name, x.company ?? '', x.batch_no ?? '', x.expiry_date ?? '',
      x.qty_in_stock, x.stock_status, x.expiry_status ?? '',
      formatTaka(x.purchase_price_paisa, { symbol: false }),
      formatTaka(x.sale_price_paisa, { symbol: false }),
    ]);
    const csv = toCSV(
      ['ওষুধ', 'কোম্পানি', 'ব্যাচ', 'মেয়াদ', 'স্টক', 'অবস্থা', 'মেয়াদ-অবস্থা', 'ক্রয়', 'বিক্রয়'],
      rows,
    );
    downloadCSV(`inventory-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="card space-y-3">
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="স্টক শেষ" value={r.outCount} tone="danger" />
            <Stat label="কম স্টক" value={r.lowCount} tone="alert" />
            <Stat label="মেয়াদ কাছে" value={r.expiringCount} tone="alert" />
            <Stat label="মেয়াদোত্তীর্ণ" value={r.expiredCount} tone="danger" />
            <div className="card">
              <p className="text-sm text-gray-500">স্টক মূল্য</p>
              <p className="mt-1 text-lg font-bold text-brand-dark">{formatTaka(r.stockValuePaisa)}</p>
            </div>
          </div>
          <button className="btn-outline px-3 py-2 text-sm" onClick={exportCSV}>সম্পূর্ণ ইনভেন্টরি CSV</button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'alert' }) {
  const c = tone === 'danger' ? 'text-danger' : 'text-alert';
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${c}`}>{toBanglaDigits(value)}</p>
    </div>
  );
}
