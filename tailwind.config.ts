import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#CC2222',
        'brand-dark': '#991818',
        'brand-light': 'rgba(204,34,34,0.1)',
        surface: '#1A1A1A',
        'surface-2': '#222222',
        border: '#2a2a2a',
      },
    },
  },
  plugins: [],
}

export default config
