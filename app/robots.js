export default function robots() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    ...(host ? { sitemap: `https://${host}/sitemap.xml` } : {})
  };
}
