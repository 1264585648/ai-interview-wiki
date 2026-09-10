import { getLLMText, getPageMarkdownUrl, getPageSafe } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

export async function GET(_req: Request, { params }: RouteContext<'/llms.mdx/docs/[[...slug]]'>) {
  const { slug } = await params;
  const last = slug?.[slug.length - 1];
  const target = last && (last.endsWith('.md') || last === 'content.md') ? slug.slice(0, -1) : slug;
  const page = getPageSafe(target);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

