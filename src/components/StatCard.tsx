import { formatTaka } from '@/lib/money';

export function StatCard({
  label, valuePaisa, value, tone = 'brand',
}: {
  label: string;
  valuePaisa?: number;
  value?: string;
  tone?: 'brand' | 'success' | 'alert' | 'danger';
}) {
  const toneClass = {
    brand: 'text-brand-dark',
    success: 'text-success',
    alert: 'text-alert',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>
        {value ?? formatTaka(valuePaisa ?? 0)}
      </p>
    </div>
  );
}
