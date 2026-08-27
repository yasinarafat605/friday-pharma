// টাকা সবসময় integer paisa হিসেবে রাখা হয় (floating-point error এড়াতে)।
// ১ টাকা = ১০০ পয়সা।

export type Paisa = number; // integer

export function takaToPaisa(taka: number | string): Paisa {
  const n = typeof taka === 'string' ? parseFloat(taka) : taka;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function paisaToTaka(paisa: Paisa): number {
  return Math.round(paisa) / 100;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!);
}

/** ১২৳৳ → "১,২৩৪.৫৬ ৳" বাংলা সংখ্যায় */
export function formatTaka(paisa: Paisa, opts: { symbol?: boolean } = {}): string {
  const taka = paisaToTaka(paisa);
  const fixed = taka.toFixed(2);
  const [intPart, dec] = fixed.split('.');
  // বাংলাদেশি গ্রুপিং (হাজার/লাখ) সরল রূপ: সাধারণ হাজার গ্রুপিং
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const str = `${grouped}.${dec}`;
  const bn = toBanglaDigits(str);
  return opts.symbol === false ? bn : `${bn} ৳`;
}

export function addPaisa(...values: Paisa[]): Paisa {
  return values.reduce((a, b) => a + Math.round(b || 0), 0);
}
