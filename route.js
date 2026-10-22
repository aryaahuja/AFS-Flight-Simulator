export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ url: process.env.AFS_MULTIPLAYER_SERVER_URL || '' }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
