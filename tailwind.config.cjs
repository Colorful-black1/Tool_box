/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: '#080b16',
        panel: '#141a30',
        gold: '#e8c98a',
        'gold-dim': '#b89b62',
        cyan: '#7fe7ff',
        purple: '#b48cf2',
        'text-hi': '#f4eedd',
        'text-mid': '#a9b0c8',
        'text-dim': '#5d6480'
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', 'STSong', 'SimSun', 'serif'],
        sans: ['"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif']
      }
    }
  },
  plugins: []
}
