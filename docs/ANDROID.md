# অ্যান্ড্রয়েড অ্যাপ (APK) গাইড

আশ শিফা ফার্মেসী সম্পূর্ণ local — তাই দুইভাবে ফোনে ব্যবহার করা যায়। **APK (উপায় ২)** সুপারিশকৃত: আসল অ্যাপের মতো ইনস্টল হয়, অফলাইন চলে, কোনো সার্ভার লাগে না।

---

## উপায় ১ — PWA (দ্রুত, বিল্ড ছাড়াই)

1. কম্পিউটারে `npm install && npm run build && npm run start` চালান (অথবা যেকোনো HTTPS হোস্টে `out/` ফোল্ডার রাখুন)।
2. ফোনের Chrome-এ ওই ঠিকানা খুলুন।
3. মেনু (⋮) → **Add to Home screen / অ্যাপ ইনস্টল করুন**।
4. হোম স্ক্রিনে আইকন আসবে; পূর্ণ-স্ক্রিন অ্যাপের মতো চলবে, অফলাইনেও।

> PWA-র জন্য HTTPS দরকার (Web Crypto/PIN-এর জন্য)। শুধু নিজের ফোনে টেস্ট করলে উপায় ২ সহজ।

---

## উপায় ২ — Capacitor দিয়ে APK (সুপারিশকৃত)

### একবারের পূর্বশর্ত (কম্পিউটারে)
- **Node.js ≥ 18**
- **JDK 17** (Android Gradle-এর জন্য)
- **Android Studio** (SDK + Platform-Tools সহ) — https://developer.android.com/studio

### ধাপ

```bash
# 1) dependency
npm install

# 2) static bundle তৈরি (out/ ফোল্ডার)
npm run build

# 3) প্রথমবার Android প্রজেক্ট যোগ করুন
npm run android:init        # = cap add android

# 4) অ্যাপ আইকন/স্প্ল্যাশ বসান (resources/ থেকে)
npm run android:icons       # = capacitor-assets generate --android

# 5) ওয়েব বিল্ড → Android-এ কপি
npm run android:sync        # = next build && cap sync android

# 6) Android Studio-তে খুলুন
npm run android:open
```

Android Studio খুললে:
- **Run ▶** চাপলে সংযুক্ত ফোনে/এমুলেটরে অ্যাপ চলবে।
- APK বানাতে: **Build → Build Bundle(s)/APK(s) → Build APK(s)**।
  তৈরি ফাইল: `android/app/build/outputs/apk/debug/app-debug.apk` — এই ফাইল ফোনে কপি করে ইনস্টল করুন (Unknown sources অনুমতি দিন)।

### কমান্ড দিয়ে APK (Android Studio ছাড়াও)
```bash
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
# আউটপুট: android/app/build/outputs/apk/debug/app-debug.apk
```

### কোড বদলালে
```bash
npm run android:sync           # আবার build + copy
```

---

## রিলিজ (Play Store বা distributable) APK — signed

1. একটি keystore বানান (একবার):
   ```bash
   keytool -genkey -v -keystore asshifa.keystore -alias asshifa -keyalg RSA -keysize 2048 -validity 10000
   ```
2. `android/app/build.gradle`-এ signingConfig যোগ করুন (Android docs অনুযায়ী), অথবা Android Studio → **Build → Generate Signed Bundle / APK**।
3. রিলিজ বিল্ড:
   ```bash
   cd android && ./gradlew assembleRelease
   ```
   আউটপুট: `android/app/build/outputs/apk/release/app-release.apk`।

> keystore ও পাসওয়ার্ড নিরাপদে রাখুন — হারালে একই অ্যাপ আপডেট দেওয়া যাবে না।

---

## অ্যাপ পরিচিতি
- **App ID:** `com.asshifa.pharmacy` (capacitor.config.ts-এ পরিবর্তনযোগ্য)
- **নাম:** আশ শিফা ফার্মেসী
- আইকন সোর্স: `resources/icon.png` (1024×1024) ও `resources/splash.png` — বদলাতে চাইলে এগুলো পাল্টে `npm run android:icons` চালান।

## গুরুত্বপূর্ণ (মোবাইলে ডেটা)
সব ডেটা ফোনের ভেতরেই থাকে (WebView storage)। **অ্যাপ আনইনস্টল বা ফোন রিসেট করলে ডেটা মুছে যাবে।** তাই নিয়মিত মেনু → **ব্যাকআপ** থেকে এনক্রিপ্টেড ব্যাকআপ নিয়ে ফোনের ফাইল/Google Drive/USB-তে রাখুন।
