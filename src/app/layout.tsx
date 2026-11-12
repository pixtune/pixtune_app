import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'PixTune — A trilha sonora da sua live',
  description:
    'PixTune - A trilha sonora da sua live, guiada pelo público em tempo real. Pedidos de música pela mensagem do Live Pix.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#070F14',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('pixtune_high_contrast') === 'true') {
                  document.documentElement.classList.add('high-contrast');
                }
                if (localStorage.getItem('pixtune_reduced_motion') === 'true') {
                  document.documentElement.classList.add('reduce-motion');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="bg-pixtune-bg text-pixtune-text antialiased min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

