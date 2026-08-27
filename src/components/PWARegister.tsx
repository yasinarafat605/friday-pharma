'use client';

import { useEffect } from 'react';

// সব পেজে (login সহ) service worker রেজিস্টার করে — PWABuilder/PWA install-এর জন্য দরকার।
export default function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
