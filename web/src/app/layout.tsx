import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration';
import './globals.css';

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'WOVEXA — Apparel Design Studio', template: '%s · WOVEXA' },
  description: 'Design apparel in real print dimensions, see every edit on a 3D garment, and hand off production-ready files. From Concept to Creation.',
  applicationName: 'WOVEXA',
  appleWebApp: { capable: true, title: 'WOVEXA', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/brand/wovexa-favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e11' },
  ],
};

// Applies the saved theme before first paint so there is no flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('wovexa.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
