// ওষুধের পাতা বা প্যাক স্ক্যান করে পাওয়া লেখা থেকে নাম, পাওয়ার ও জেনেরিক আলাদা করা।
// এখানে কোনো ক্যামেরা বা প্লাগইন নেই — সবই খাঁটি ফাংশন, তাই টেস্ট করা যায়।

import type { MedicineType } from '@/types/db';

export interface ParsedLabel {
  /** ব্র্যান্ড নাম, যেমন Napa */
  name: string;
  /** পাওয়ার, যেমন 500 mg */
  strength: string | null;
  /** জেনেরিক নাম, যেমন Paracetamol */
  generic: string | null;
  /** পাতা থেকে অনুমান করা ধরন */
  type: MedicineType | null;
  /** কোম্পানির নাম, পাওয়া গেলে */
  company: string | null;
  /** নাম হিসেবে সম্ভাব্য অন্য লাইনগুলো, ভুল হলে বেছে নেওয়ার জন্য */
  candidates: string[];
}

/** কোম্পানির নাম চেনার শব্দ। */
const COMPANY_WORDS = [
  'ltd', 'limited', 'pharma', 'pharmaceutical', 'pharmaceuticals', 'laboratories',
  'labs', 'industries', 'chemical', 'chemicals', 'healthcare', 'remedies', 'company',
];

/** যেসব লাইন কখনোই ওষুধের নাম নয়। */
const NOISE_PATTERNS = [
  /\bbatch\b/i, /\bb\.?no\.?\b/i, /\blot\b/i,
  /\bmfg\b/i, /\bmfd\b/i, /\bmanufactur/i,
  /\bexp\b/i, /\bexpiry\b/i, /\bexpires?\b/i,
  /\bmrp\b/i, /\bprice\b/i, /\bটাকা\b/, /৳/,
  /\bkeep\b/i, /\bstore\b/i, /\bstorage\b/i, /\bdosage\b/i, /\bdirections?\b/i,
  /\bchildren\b/i, /\bprescription\b/i, /\bphysician\b/i, /\bdoctor\b/i,
  /\breach\b/i, /\bcool\b/i, /\bdry place\b/i, /\bprotect\b/i,
  /\bmade in\b/i, /\bimported\b/i, /\bregd?\b/i, /\bdar\b/i,
  /^\d[\d\s./-]*$/,
];

/** ধরন চেনার শব্দ। */
const TYPE_WORDS: { re: RegExp; type: MedicineType }[] = [
  { re: /\btablets?\b|\bট্যাবলেট\b/i, type: 'tablet' },
  { re: /\bcapsules?\b|\bক্যাপসুল\b/i, type: 'capsule' },
  { re: /\bsyrup\b|\bsuspension\b|\bসিরাপ\b/i, type: 'syrup' },
  { re: /\binjections?\b|\biv infusion\b|\bampoule\b/i, type: 'injection' },
  { re: /\b(eye|ear|nasal)?\s*drops?\b/i, type: 'drop' },
  { re: /\bcream\b|\bointment\b|\bgel\b/i, type: 'cream' },
  { re: /\bpowder\b|\bsachet\b/i, type: 'powder' },
  { re: /\bsaline\b|\bnormal saline\b/i, type: 'saline' },
];

/** পাওয়ার: 500 mg, 10 ml, 250mg/5ml, 5%, 1000 IU */
const STRENGTH_RE =
  /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|gm|g|ml|l|iu|%)(\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|ml|g))?/i;

/** ফার্মাকপিয়ার চিহ্ন — এই লাইনটি প্রায় সবসময় জেনেরিক নাম। */
const PHARMACOPOEIA_RE = /\b(bp|usp|inn|ip|ph\.?\s*eur)\b/i;

/** সাধারণ জেনেরিক নামের শেষাংশ। */
const GENERIC_SUFFIX_RE =
  /(cillin|mycin|cycline|azole|prazole|olol|pril|sartan|dipine|statin|profen|caine|adol|amol|oxacin|tidine|zepam|azepam|floxacin|thromycin|conazole|cetamol|metformin|salbutamol)\b/i;

function clean(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isNoise(line: string): boolean {
  const t = clean(line);
  if (t.length < 2) return true;
  return NOISE_PATTERNS.some((re) => re.test(t));
}

function isCompany(line: string): boolean {
  const t = line.toLowerCase();
  return COMPANY_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));
}

/** লাইন থেকে পাওয়ার বের করে, যেমন "Napa 500 mg" → "500 mg" */
export function extractStrength(line: string): string | null {
  const m = STRENGTH_RE.exec(line);
  if (!m) return null;
  const unit = m[2]!.toLowerCase().replace('ug', 'mcg').replace('µg', 'mcg');
  const base = `${m[1]} ${unit}`;
  if (m[4] && m[5]) return `${base}/${m[4]} ${m[5]!.toLowerCase()}`;
  return base;
}

/** পাওয়ার ও ধরনের শব্দ বাদ দিয়ে শুধু নামটুকু। */
function stripToName(line: string): string {
  let t = line.replace(STRENGTH_RE, ' ');
  for (const { re } of TYPE_WORDS) t = t.replace(re, ' ');
  t = t.replace(PHARMACOPOEIA_RE, ' ');
  t = t.replace(/[®™©]/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s+.-]/gu, ' ');
  return clean(t);
}

/** একটি লাইন কতটা "ব্র্যান্ড নামের মতো" — বেশি হলে ভালো। */
function nameScore(line: string, index: number): number {
  const t = stripToName(line);
  if (!t) return -100;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters < 3) return -100;
  let score = 0;
  score += Math.max(0, 12 - index * 3); // উপরের লাইন বেশি সম্ভাবনাময়
  if (/^[A-Z][a-zA-Z]/.test(t)) score += 4;
  if (t === t.toUpperCase() && letters > 2) score += 3;
  const words = t.split(' ').filter(Boolean).length;
  if (words <= 3) score += 4;
  if (words > 5) score -= 6;
  if (isCompany(line)) score -= 20;
  if (GENERIC_SUFFIX_RE.test(t)) score -= 5; // জেনেরিক হওয়ার সম্ভাবনা বেশি
  if (PHARMACOPOEIA_RE.test(line)) score -= 12;
  return score;
}

/**
 * স্ক্যান করে পাওয়া লাইনগুলো থেকে নাম, পাওয়ার, জেনেরিক ও ধরন অনুমান করে।
 * ভুল হতে পারে — তাই ফলাফল সবসময় সংশোধনযোগ্য ফর্মে দেখানো হয়।
 */
export function parseMedicineLabel(rawLines: string[]): ParsedLabel {
  const lines = rawLines.map(clean).filter((l) => l.length > 0);
  const usable = lines.filter((l) => !isNoise(l));

  // পাওয়ার — যেকোনো লাইনে প্রথম যেটি পাওয়া যায়
  let strength: string | null = null;
  for (const l of usable) {
    const s = extractStrength(l);
    if (s) { strength = s; break; }
  }

  // ধরন
  let type: MedicineType | null = null;
  for (const l of usable) {
    const hit = TYPE_WORDS.find(({ re }) => re.test(l));
    if (hit) { type = hit.type; break; }
  }

  // কোম্পানি
  const companyLine = usable.find(isCompany) ?? null;
  const company = companyLine ? clean(companyLine.replace(/[®™©]/g, '')) : null;

  // জেনেরিক — ফার্মাকপিয়ার চিহ্ন থাকা লাইন, নয়তো পরিচিত শেষাংশ
  const nonCompany = usable.filter((l) => !isCompany(l));
  const pharmacopoeiaLine = nonCompany.find((l) => PHARMACOPOEIA_RE.test(l));
  const suffixLine = nonCompany.find((l) => GENERIC_SUFFIX_RE.test(stripToName(l)));
  const genericLine = pharmacopoeiaLine ?? suffixLine ?? null;
  const generic = genericLine ? stripToName(genericLine) || null : null;

  // নাম — সবচেয়ে বেশি স্কোর পাওয়া লাইন, জেনেরিকের লাইন বাদে
  const scored = nonCompany
    .map((l, i) => ({ line: l, name: stripToName(l), score: nameScore(l, i) }))
    .filter((x) => x.name.length >= 2)
    .sort((a, b) => b.score - a.score);

  const best = scored.find((x) => x.line !== genericLine) ?? scored[0];
  const name = best?.name ?? '';

  const candidates = scored
    .map((x) => x.name)
    .filter((n, i, arr) => n !== name && arr.indexOf(n) === i)
    .slice(0, 5);

  return {
    name,
    strength,
    generic: generic && generic.toLowerCase() === name.toLowerCase() ? null : generic,
    type,
    company,
    candidates,
  };
}

// ============================================================
// আগে থেকে থাকা ওষুধের সাথে মিলানো
// ============================================================

export interface MatchCandidate {
  id: string;
  name: string;
  strength?: string | null;
  generic_name?: string | null;
}

export interface MatchResult<T extends MatchCandidate> {
  medicine: T;
  score: number;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '');
}

/** দুই লেখার মিল ০ থেকে ১ — ছোট ভুল বানানেও কাজ করে। */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const longer = x.length >= y.length ? x : y;
  const shorter = x.length >= y.length ? y : x;
  if (longer.includes(shorter)) return 0.9 * (shorter.length / longer.length) + 0.1;

  // Levenshtein দূরত্ব
  let prev = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    const cur = [i];
    for (let j = 1; j <= shorter.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (longer[i - 1] === shorter[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  const dist = prev[shorter.length]!;
  return Math.max(0, 1 - dist / longer.length);
}

/**
 * স্ক্যান করা নাম ও পাওয়ার দিয়ে দোকানের তালিকায় থাকা ওষুধ খোঁজে।
 * পাওয়ার মিললে স্কোর বাড়ে, যাতে Napa 500 আর Napa 665 আলাদা থাকে।
 */
export function matchMedicines<T extends MatchCandidate>(
  parsed: { name: string; strength: string | null; generic: string | null },
  medicines: T[],
  limit = 5,
): MatchResult<T>[] {
  if (!parsed.name && !parsed.generic) return [];
  const out: MatchResult<T>[] = [];
  for (const m of medicines) {
    let score = similarity(parsed.name, m.name);
    if (parsed.generic && m.generic_name) {
      score = Math.max(score, similarity(parsed.generic, m.generic_name) * 0.85);
    }
    if (parsed.strength && m.strength) {
      score += normalize(parsed.strength) === normalize(m.strength) ? 0.25 : -0.35;
    }
    if (score >= 0.55) out.push({ medicine: m, score: Math.min(1, score) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
