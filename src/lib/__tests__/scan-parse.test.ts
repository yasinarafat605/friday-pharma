import { describe, it, expect } from 'vitest';
import {
  parseMedicineLabel, extractStrength, similarity, matchMedicines,
} from '@/lib/scan/parse';

describe('পাওয়ার বের করা', () => {
  it('সাধারণ mg', () => {
    expect(extractStrength('Napa 500 mg')).toBe('500 mg');
    expect(extractStrength('NAPA500MG')).toBe('500 mg');
  });
  it('ml ও শতাংশ', () => {
    expect(extractStrength('Syrup 100 ml')).toBe('100 ml');
    expect(extractStrength('Cream 1%')).toBe('1 %');
  });
  it('সিরাপের অনুপাত', () => {
    expect(extractStrength('Paracetamol 120mg/5ml')).toBe('120 mg/5 ml');
  });
  it('mcg ও IU', () => {
    expect(extractStrength('Levothyroxine 50 mcg')).toBe('50 mcg');
    expect(extractStrength('Vitamin D 1000 IU')).toBe('1000 iu');
  });
  it('না থাকলে null', () => {
    expect(extractStrength('Keep out of reach of children')).toBeNull();
  });
});

describe('পাতার লেখা থেকে ওষুধ চেনা', () => {
  it('সাধারণ ট্যাবলেটের পাতা', () => {
    const r = parseMedicineLabel([
      'Napa',
      '500 mg',
      'Paracetamol BP',
      'Tablet',
      'Beximco Pharmaceuticals Ltd.',
      'Batch No: A1234',
      'Mfg: 01/2026  Exp: 12/2028',
    ]);
    expect(r.name).toBe('Napa');
    expect(r.strength).toBe('500 mg');
    expect(r.generic).toBe('Paracetamol');
    expect(r.type).toBe('tablet');
    expect(r.company).toContain('Beximco');
  });

  it('নাম ও পাওয়ার এক লাইনে', () => {
    const r = parseMedicineLabel([
      'SECLO 20',
      'Omeprazole 20 mg Capsule',
      'Square Pharmaceuticals Ltd',
    ]);
    expect(r.name).toBe('SECLO 20');
    expect(r.strength).toBe('20 mg');
    expect(r.generic).toContain('Omeprazole');
    expect(r.type).toBe('capsule');
  });

  it('সিরাপ চেনে', () => {
    const r = parseMedicineLabel([
      'Ace Syrup',
      'Paracetamol 120 mg/5 ml',
      'Suspension 60 ml',
    ]);
    expect(r.type).toBe('syrup');
    expect(r.strength).toBe('120 mg/5 ml');
    expect(r.name.toLowerCase()).toContain('ace');
  });

  it('ব্যাচ, মেয়াদ ও দামের লাইন নাম হিসেবে নেয় না', () => {
    const r = parseMedicineLabel([
      'B.No. 5521',
      'MRP 12.00 Taka',
      'Monas 10',
      'Montelukast Sodium INN',
      'Keep out of reach of children',
    ]);
    expect(r.name).toBe('Monas 10');
    expect(r.generic).toContain('Montelukast');
    expect(r.candidates).not.toContain('MRP 12.00 Taka');
  });

  it('কোম্পানির নাম কখনো ওষুধের নাম হয় না', () => {
    const r = parseMedicineLabel([
      'Incepta Pharmaceuticals Ltd.',
      'Fexo 120',
      'Fexofenadine Hydrochloride BP',
    ]);
    expect(r.name).toBe('Fexo 120');
    expect(r.company).toContain('Incepta');
  });

  it('ফাঁকা ইনপুটে ভাঙে না', () => {
    const r = parseMedicineLabel([]);
    expect(r.name).toBe('');
    expect(r.strength).toBeNull();
  });

  it('জেনেরিক ও নাম এক হলে জেনেরিক ফাঁকা থাকে', () => {
    const r = parseMedicineLabel(['Metformin', 'Metformin 500 mg']);
    expect(r.name.toLowerCase()).toContain('metformin');
    expect(r.generic).toBeNull();
  });
});

describe('লেখার মিল', () => {
  it('হুবহু মিল', () => {
    expect(similarity('Napa', 'Napa')).toBe(1);
  });
  it('ছোট হাতের ও বড় হাতের ফারাক ধরে না', () => {
    expect(similarity('NAPA', 'napa')).toBe(1);
  });
  it('এক অক্ষর ভুলেও মিল থাকে', () => {
    expect(similarity('Napa', 'Nape')).toBeGreaterThan(0.7);
  });
  it('আলাদা নামে মিল কম', () => {
    expect(similarity('Napa', 'Seclo')).toBeLessThan(0.4);
  });
});

describe('তালিকার সাথে মিলানো', () => {
  const meds = [
    { id: '1', name: 'Napa', strength: '500 mg', generic_name: 'Paracetamol' },
    { id: '2', name: 'Napa Extend', strength: '665 mg', generic_name: 'Paracetamol' },
    { id: '3', name: 'Seclo', strength: '20 mg', generic_name: 'Omeprazole' },
  ];

  it('নাম ও পাওয়ার মিললে সেটিই সবার আগে', () => {
    const r = matchMedicines({ name: 'Napa', strength: '500 mg', generic: 'Paracetamol' }, meds);
    expect(r[0]!.medicine.id).toBe('1');
  });

  it('একই নামে ভিন্ন পাওয়ার আলাদা থাকে', () => {
    const r = matchMedicines({ name: 'Napa Extend', strength: '665 mg', generic: null }, meds);
    expect(r[0]!.medicine.id).toBe('2');
  });

  it('ছোট বানান ভুলেও মেলে', () => {
    const r = matchMedicines({ name: 'Sedo', strength: '20 mg', generic: null }, meds);
    expect(r[0]?.medicine.id).toBe('3');
  });

  it('একেবারে অন্য নাম হলে কিছুই মেলে না', () => {
    const r = matchMedicines({ name: 'Ventolin', strength: null, generic: null }, meds);
    expect(r).toHaveLength(0);
  });

  it('জেনেরিক দিয়েও মেলে', () => {
    const r = matchMedicines({ name: '', strength: null, generic: 'Omeprazole' }, meds);
    expect(r[0]?.medicine.id).toBe('3');
  });
});
