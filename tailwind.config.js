/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f4fa',
          100: '#d9e4f0',
          200: '#b3c9e1',
          300: '#7da3c9',
          400: '#4d7db0',
          500: '#2e5f94',
          600: '#1B3A5C',
          700: '#152d47',
          800: '#0e1f32',
          900: '#08111c',
        },
        gold: {
          400: '#d4a843',
          500: '#B8952A',
          600: '#9a7a20',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
