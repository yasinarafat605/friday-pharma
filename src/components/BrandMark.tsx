// Friday Pharma ব্র্যান্ড মার্ক। SVG inline রাখা হয়েছে যাতে APK-এ অফলাইনেও আঁকে।
// আসল ফাইলগুলো brand/logo/ ফোল্ডারে আছে।

type Props = {
  className?: string;
  /** এক রঙে আঁকতে হলে (যেমন গাঢ় ব্যাকগ্রাউন্ডে সাদা) */
  mono?: string;
  title?: string;
};

const GID = 'fpm';

export default function BrandMark({ className = 'h-8 w-auto', mono, title = 'Friday Pharma' }: Props) {
  return (
    <svg viewBox="0 0 472 648" className={className} role="img" aria-label={title} fill="none">
      <defs>
        {mono ? (
          // এক রঙে আঁকলে ক্রসটা মিশে যেতো, তাই পাতা থেকে ক্রসের জায়গা কেটে নেওয়া হয়
          <mask id={`${GID}Knock`}>
            <rect x="0" y="0" width="472" height="648" fill="#fff" />
            <g fill="#000">
              <rect x="104" y="360" width="80" height="176" rx="22" />
              <rect x="56" y="408" width="176" height="80" rx="22" />
            </g>
          </mask>
        ) : (
          <>
            <linearGradient id={`${GID}Green`} x1="0" y1="0" x2="1" y2="0.45">
              <stop offset="0" stopColor="#0E9E75" />
              <stop offset="0.5" stopColor="#16BE86" />
              <stop offset="1" stopColor="#63E2B1" />
            </linearGradient>
            <linearGradient id={`${GID}Blue`} x1="0" y1="0" x2="1" y2="0.45">
              <stop offset="0" stopColor="#2563EB" />
              <stop offset="1" stopColor="#5E90F9" />
            </linearGradient>
            <linearGradient id={`${GID}Navy`} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0" stopColor="#1E3A8A" />
              <stop offset="1" stopColor="#0A1D37" />
            </linearGradient>
            <linearGradient id={`${GID}Cross`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#63E2B1" />
              <stop offset="1" stopColor="#10B881" />
            </linearGradient>
          </>
        )}
      </defs>

      <g mask={mono ? `url(#${GID}Knock)` : undefined}>
        <path fill={mono ?? `url(#${GID}Navy)`} d="M0.0,264.0L0.0,384.0C0.0,472.0 72.0,552.0 176.0,552.0C236.0,552.0 268.0,516.0 276.0,464.0C260.0,484.0 216.0,468.0 184.0,452.0C152.0,440.0 128.0,416.0 128.0,376.0L128.0,264.0Z" />
        <path fill={mono ?? `url(#${GID}Blue)`} d="M132.0,180.0L380.0,180.0L380.0,200.4C380.0,250.8 355.2,316.0 289.6,316.0L132.0,316.0C84.4,324.0 35.6,380.0 9.6,438.4L2.8,434.4L2.8,264.4C8.4,226.4 56.0,212.0 132.0,180.0Z" />
        <path fill={mono ?? `url(#${GID}Green)`} d="M140.0,12.0L428.0,12.0L428.0,32.0C428.0,80.8 399.2,144.0 322.8,144.0L140.0,144.0C97.6,151.2 53.6,201.2 30.8,253.2L24.8,249.2L24.8,87.2C29.6,53.2 72.0,40.4 140.0,12.0Z" />
      </g>
      <g fill={mono ?? `url(#${GID}Cross)`}>
        <rect x="120" y="376" width="48" height="144" rx="12" />
        <rect x="72" y="424" width="144" height="48" rx="12" />
      </g>
    </svg>
  );
}
