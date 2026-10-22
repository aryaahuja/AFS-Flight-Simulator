import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata = {
  title: 'AFS Flight Simulator',
  description: 'AFS Flight Simulator by Arya Ahuja — fly airliners, fighters and bombers with realistic flight physics, weather, airports, GPWS and landing replay.',
  applicationName: 'AFS Flight Simulator',
  creator: 'Arya Ahuja',
  keywords: [
    'AFS Flight Simulator',
    'flight simulator',
    'browser flight simulator',
    'aircraft simulator',
    'A320neo simulator',
    'Boeing 737 simulator',
    'F-22 simulator',
    'B-2 simulator'
  ],
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/afs-icon.svg', type: 'image/svg+xml' },
      { url: '/afs-icon-192.png', type: 'image/png', sizes: '192x192' }
    ],
    shortcut: '/favicon.ico',
    apple: '/afs-icon-192.png'
  },
  manifest: '/manifest.webmanifest'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
