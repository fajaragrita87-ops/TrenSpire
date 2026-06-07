/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F0F2F8',
        card: '#FFFFFF',
        cardSoft: '#FAFBFF',
        textPrimary: '#1A1D2E',
        textSecondary: '#9196A8',
        purple: '#7C3AED',
        purpleDeep: '#5B21B6',
        gold: '#F5B400',
        goldSoft: '#FFC72C',
        teal: '#0FA79D',
        tealDeep: '#0D8C83',
        lavender: '#C4B5FD',
      },
      boxShadow: {
        card: '0 20px 45px rgba(26, 29, 46, 0.08)',
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
}
