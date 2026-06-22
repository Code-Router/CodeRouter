/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        panel: '#12151c',
        panel2: '#171b24',
        border: '#232a36',
        muted: '#8b93a7',
        text: '#e6e9f0',
        accent: '#5b8cff',
        ok: '#3fb950',
        warn: '#d29922',
        bad: '#f85149',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
