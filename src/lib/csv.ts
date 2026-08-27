// CSV export — ব্যাকআপ/হিসাবের জন্য (invoice/bill নয়)।

function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const head = headers.map(escapeCell).join(',');
  const body = rows.map((r) => r.map(escapeCell).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadCSV(filename: string, csv: string): void {
  // BOM যোগ করা হলো যাতে Excel-এ বাংলা ঠিকভাবে দেখায়।
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
