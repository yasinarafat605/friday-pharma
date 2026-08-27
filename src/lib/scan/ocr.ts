'use client';

// ক্যামেরা দিয়ে ওষুধের পাতার ছবি তুলে লেখা পড়া (Google ML Kit, অফলাইন)।
// শুধু Android অ্যাপে কাজ করে — ব্রাউজারে বাটনটি দেখানো হয় না।
// ছবি কোথাও পাঠানো হয় না, ডিভাইসেই প্রক্রিয়া হয় এবং সংরক্ষণও হয় না।

import { parseMedicineLabel, type ParsedLabel } from './parse';

export interface ScanResult {
  parsed: ParsedLabel;
  /** পড়া সব লাইন, ভুল হলে দেখে নেওয়ার জন্য */
  lines: string[];
  rawText: string;
}

/** এই ডিভাইসে স্ক্যান করা সম্ভব কিনা (Android অ্যাপ হলে হ্যাঁ)। */
export async function isScanSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

interface TextElement { text?: string }
interface TextLine { text?: string; elements?: TextElement[] }
interface TextBlock { text?: string; lines?: TextLine[] }

/** ব্লক ও লাইনের কাঠামো থেকে সাধারণ লাইনের তালিকা। */
function toLines(result: { text?: string; blocks?: TextBlock[] }): string[] {
  const out: string[] = [];
  for (const b of result.blocks ?? []) {
    for (const l of b.lines ?? []) {
      const t = (l.text ?? '').trim();
      if (t) out.push(t);
    }
    if (!b.lines?.length && b.text) out.push(b.text.trim());
  }
  if (out.length === 0 && result.text) {
    return result.text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

/**
 * ক্যামেরা খুলে ছবি তোলে, লেখা পড়ে এবং নাম, পাওয়ার ও জেনেরিক অনুমান করে।
 * ব্যবহারকারী ছবি তোলা বাতিল করলে null ফেরে।
 */
export async function scanMedicinePack(): Promise<ScanResult | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const { CapacitorPluginMlKitTextRecognition } =
    await import('@pantrist/capacitor-plugin-ml-kit-text-recognition');

  let base64: string | undefined;
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      correctOrientation: true,
    });
    base64 = photo.base64String;
  } catch {
    return null; // ব্যবহারকারী বাতিল করেছেন
  }
  if (!base64) return null;

  const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: base64 });
  const lines = toLines(result as { text?: string; blocks?: TextBlock[] });
  return {
    parsed: parseMedicineLabel(lines),
    lines,
    rawText: (result as { text?: string }).text ?? lines.join('\n'),
  };
}
