import type { Config } from 'tailwindcss'

/**
 * Cores em variáveis CSS para permitir o modo de alto contraste sem duplicar
 * todas as classes utilitárias usadas no produto.
 * Paleta oficial: PixTune Brandbook v1.0.
 */
const color = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        pixtune: {
          bg: color('--pt-bg'),
          surface: color('--pt-surface'),
          surfaceElevated: color('--pt-surface-elevated'),
          border: color('--pt-border'),
          primary: color('--pt-primary'),
          primaryHover: color('--pt-primary-hover'),
          primaryMuted: 'rgb(var(--pt-primary) / 0.15)',
          cyan: color('--pt-cyan'),
          aqua: color('--pt-aqua'),
          navy: color('--pt-bg'),
          black: color('--pt-black'),
          text: color('--pt-text'),
          textSecondary: color('--pt-text-secondary'),
          textMuted: color('--pt-text-muted'),
          danger: color('--pt-danger'),
          warning: color('--pt-warning'),
          success: color('--pt-success'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        'display-lg': ['4rem', { lineHeight: '1.08', letterSpacing: '-0.03em' }],
        'display-md': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        'display-sm': ['2.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        // H1 de página no painel: 36px no celular, 44px no desktop (Brandbook §5.2).
        'page-title': ['2.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'heading-lg': ['2.25rem', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
        'heading-md': ['1.75rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        'heading-sm': ['1.375rem', { lineHeight: '1.35' }],
        'body-lg': ['1.125rem', { lineHeight: '1.6' }],
        'body': ['1rem', { lineHeight: '1.5' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5' }],
        'caption': ['0.75rem', { lineHeight: '1.5' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        card: '0.75rem',
        modal: '1rem',
      },
      boxShadow: {
        'pixtune': '0 8px 30px rgba(3, 7, 11, 0.35)',
        'pixtune-lg': '0 16px 60px rgba(3, 7, 11, 0.5)',
        'glow-green': '0 0 24px rgba(30, 215, 96, 0.18)',
        'glow-cyan': '0 0 24px rgba(0, 224, 255, 0.16)',
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '180ms',
        'slow': '300ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-green': 'pulseGreen 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGreen: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(30, 215, 96, 0.4)' },
          '50%': { boxShadow: '0 0 0 12px rgba(30, 215, 96, 0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config