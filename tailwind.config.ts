import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Section ১৭ recommended palette
        brand: {
          DEFAULT: '#0f7a4d', // Deep Green (primary)
          dark: '#0b5a39',
          light: '#e6f4ee',
        },
        alert: '#f97316', // Orange — low stock / warnings
        danger: '#dc2626', // Red — expired / out of stock
        success: '#16a34a', // Green — healthy
        ink: '#1f2937', // Dark gray text
      },
      fontFamily: {
        bangla: ['var(--font-bangla)', 'Noto Sans Bengali', 'Hind Siliguri', 'sans-serif'],
      },
      fontSize: {
        // Larger defaults for low-tech users
        base: ['1.05rem', { lineHeight: '1.7' }],
        btn: ['1.15rem', { lineHeight: '1.4' }],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};

export default config;
