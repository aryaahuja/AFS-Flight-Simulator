export default function manifest() {
  return {
    name: 'AFS Flight Simulator',
    short_name: 'AFS',
    description: 'AFS Flight Simulator by Arya Ahuja',
    start_url: '/',
    display: 'standalone',
    background_color: '#050c18',
    theme_color: '#081426',
    icons: [
      { src: '/afs-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/afs-icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  };
}
