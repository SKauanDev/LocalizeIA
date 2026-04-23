/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#020617',
        panel: '#0f172a',
        panelSoft: '#1e293b',
        accent: '#22d3ee',
      },
    },
  },
  plugins: [],
}
