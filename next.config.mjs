/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Android APK (Capacitor) ও offline PWA-র জন্য static export।
  // সব পেজ client-side; কোনো server/DB নেই — তাই পুরো অ্যাপ static bundle হয়।
  output: 'export',
  // Capacitor WebView-এ route ফোল্ডার হিসেবে resolve হয়।
  trailingSlash: true,
  images: { unoptimized: true },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
