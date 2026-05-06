import type { Config } from 'tailwindcss'

const config: Config = {
  // dark mode = classe '.theme-dark' sur <html> (cf. mockup v3, géré par ThemeProvider)
  darkMode: ['class', '.theme-dark'],

  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],

  theme: {
    extend: {
      // ─────────────────────────────────────────────────────
      // COULEURS
      // ─────────────────────────────────────────────────────
      colors: {
        // Marque — valeurs fixes (ne dépendent pas du thème)
        // - bg-brand (DEFAULT)        → 128 usages existants conservés
        // - bg-brand-dark             → 13 usages existants conservés (alias vers hover)
        // - bg-brand-soft / -hover    → nouvelles variants
        brand: {
          DEFAULT: '#E11D2E',
          hover:   '#C8102E',
          dark:    '#C8102E', // alias pour compat ascendante avec bg-brand-dark
          soft:    '#FFE5E8',
        },

        // Sémantique — basculent automatiquement avec le thème via CSS vars
        // Variants : DEFAULT (texte/icône), soft (fond fade), fill (fond solide)
        success: {
          DEFAULT: 'var(--color-success)',
          soft:    'var(--color-success-soft)',
          fill:    'var(--color-success-fill)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          soft:    'var(--color-warning-soft)',
          fill:    'var(--color-warning-fill)',
        },
        alert: {
          DEFAULT: 'var(--color-alert)',
          soft:    'var(--color-alert-soft)',
          fill:    'var(--color-alert-fill)',
        },
        critical: {
          DEFAULT: 'var(--color-critical)',
          soft:    'var(--color-critical-soft)',
          fill:    'var(--color-critical-fill)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          soft:    'var(--color-info-soft)',
          fill:    'var(--color-info-fill)',
        },
        purple: {
          DEFAULT: 'var(--color-purple)',
          soft:    'var(--color-purple-soft)',
        },

        // Structurels (chaud) — basculent avec le thème
        page:    'var(--bg-page)',
        surface: {
          DEFAULT: 'var(--bg-surface)',
          2:       'var(--bg-surface-2)',
          hover:   'var(--bg-surface-hover)',
        },
        // Texte (préfixe `ink` = encre, pas de collision avec utilitaires Tailwind)
        ink: {
          DEFAULT:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
          faint:     'var(--text-faint)',
        },
        // Bordure : on garde `border` comme couleur (préserve les 13 `border-border`
        // existants) ; en complément on définit `borderColor.DEFAULT` plus bas.
        border: 'var(--border)',
      },

      // Permet d'utiliser `border` (sans suffixe) avec la couleur du thème,
      // et `border-strong` pour la teinte plus marquée.
      borderColor: {
        DEFAULT: 'var(--border)',
        strong:  'var(--border-strong)',
      },

      // ─────────────────────────────────────────────────────
      // POLICES — variables CSS chargées via next/font dans layout.tsx
      // ─────────────────────────────────────────────────────
      fontFamily: {
        // `sans` = body par défaut (Inter)
        sans:    ['var(--font-body)',    'Inter', 'system-ui', 'sans-serif'],
        body:    ['var(--font-body)',    'Inter', 'sans-serif'],
        display: ['var(--font-display)', 'Plus Jakarta Sans', 'sans-serif'],
        mono:    ['var(--font-mono)',    'JetBrains Mono', 'Menlo', 'monospace'],
      },

      // ─────────────────────────────────────────────────────
      // BORDER RADIUS — défauts Tailwind suffisent, on ajoute 2 alias sémantiques
      // (Tailwind: md=6px, lg=8px, xl=12px, 2xl=16px)
      // ─────────────────────────────────────────────────────
      borderRadius: {
        btn:  '8px',  // alias rounded-btn  → boutons
        card: '12px', // alias rounded-card → panels et cards
      },

      // ─────────────────────────────────────────────────────
      // SHADOWS — référencent les vars (chaud en light, neutre en dark)
      // ─────────────────────────────────────────────────────
      boxShadow: {
        sm:           'var(--shadow-sm)',
        DEFAULT:      'var(--shadow-md)',
        md:           'var(--shadow-md)',
        card:         'var(--shadow-card)',
        // Lueur rouge marque pour le CTA primaire (cf. mockup v3 .btn-primary)
        brand:        '0 1px 2px rgba(225, 29, 46, 0.20), inset 0 1px 0 rgba(255,255,255,0.15)',
        'brand-hover':'0 2px 6px rgba(225, 29, 46, 0.30)',
      },

      // ─────────────────────────────────────────────────────
      // ANIMATIONS — pulse-soft pour les éléments en alerte
      // ─────────────────────────────────────────────────────
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.7', transform: 'scale(1.05)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },

  plugins: [],
}

export default config
