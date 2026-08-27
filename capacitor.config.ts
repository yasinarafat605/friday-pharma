import type { CapacitorConfig } from '@capacitor/cli';

// Android APK (Capacitor)। অ্যাপ সম্পূর্ণ local — Next static export (`out/`) WebView-এ চলে।
// androidScheme: 'https' → secure context, তাই Web Crypto (PIN hash) ও IndexedDB কাজ করে।
const config: CapacitorConfig = {
  appId: 'com.asshifa.pharmacy',
  appName: 'আশ শিফা ফার্মেসী',
  webDir: 'out',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
