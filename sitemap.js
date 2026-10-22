export default function sitemap() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return [];
  return [
    {
      url: `https://${host}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    }
  ];
}
