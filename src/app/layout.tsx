import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../tailwind.css';
import '../style.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'in Scheduler · LinkedIn & Instagram post planner',
  description: 'Plan a month of LinkedIn and Instagram posts in minutes with a beautiful visual calendar.',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

// viewport-fit=cover lets the mobile layout use the full screen and respect the notch / home bar
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Apply the saved theme (or the OS preference) before paint so there is no flash.
const themeScript = `(function () {
  try {
    var saved = localStorage.getItem('lps_theme');
    var theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
  } catch (e) {
    /* storage unavailable: the app still defaults to bright mode */
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#ffffff" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
