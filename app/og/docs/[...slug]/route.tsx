import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { appName } from '@/lib/shared';

export const revalidate = false;

function escapeXml(unsafe: string) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  const title = escapeXml(page.data.title || appName);
  const desc = escapeXml(page.data.description || '');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="100%" height="100%" fill="#0a0a0c"/>
  <circle cx="900" cy="150" r="300" fill="#3b82f6" opacity="0.12"/>
  <text x="80" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${title}</text>
  <text x="80" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#94a3b8">${desc}</text>
  <text x="80" y="550" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#60a5fa">${escapeXml(appName)}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

export function generateStaticParams() {
  return [];
}

