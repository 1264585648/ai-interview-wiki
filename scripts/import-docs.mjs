import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'D:/蚂蚁/LLMentor离线文档/阿里云 Thoughts 6963289eb0fc2e001bb052eb';
const TARGET_DOCS_DIR = path.resolve('content/docs');

// HTML tags allowed in MDX
const ALLOWED_HTML_TAGS = new Set([
  'br', 'hr', 'img', 'a', 'span', 'div', 'p', 'b', 'i', 'strong', 'em',
  'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'ul', 'ol', 'li', 'details', 'summary', 'sub', 'sup', 'kbd',
  'mark', 'del', 'ins', 's', 'strike'
]);

function sanitizeMdxText(text) {
  // Replace { and } outside code blocks
  let result = text
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');

  // Replace < when not part of an allowed HTML tag or closing tag
  result = result.replace(/<(\/?)([a-zA-Z0-9_\-]+)([^>]*)>/g, (match, slash, tagName, rest) => {
    if (ALLOWED_HTML_TAGS.has(tagName.toLowerCase())) {
      return match;
    }
    return `&lt;${slash}${tagName}${rest}&gt;`;
  });

  // Also replace any remaining lone < (e.g. "< 100", "<10ms", "<=", "<-")
  result = result.replace(/<(?![a-zA-Z\/])/g, '&lt;');

  return result;
}

function processMarkdownContent(rawContent, extractedTitle) {
  // Split into code blocks and normal text
  const tokens = [];
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(rawContent)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: rawContent.slice(lastIndex, match.index) });
    }
    tokens.push({ type: 'code', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < rawContent.length) {
    tokens.push({ type: 'text', content: rawContent.slice(lastIndex) });
  }

  const processed = tokens.map(token => {
    if (token.type === 'code') return token.content;
    return sanitizeMdxText(token.content);
  }).join('');

  const frontmatter = `---\ntitle: ${JSON.stringify(extractedTitle)}\n---\n\n`;
  return frontmatter + processed;
}

function cleanSlug(filename) {
  let name = filename.replace(/\.md$/i, '');
  // Extract leading number if any
  const numMatch = name.match(/^(\d+)[-_.]*/);
  let prefix = '';
  if (numMatch) {
    prefix = numMatch[1] + '-';
    name = name.slice(numMatch[0].length);
  }

  // Remove emoji and troublesome symbols
  name = name
    .replace(/[✅❌？?！!【】（）()&，,、:：·]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!name) name = 'page';
  return prefix + name;
}

async function run() {
  console.log('Starting import from:', SOURCE_DIR);
  console.log('Target directory:', TARGET_DOCS_DIR);

  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
  const chapterDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  console.log(`Found ${chapterDirs.length} chapters.`);

  const importedChapterSlugs = [];

  for (const chapterName of chapterDirs) {
    try {
      const srcChapterPath = path.join(SOURCE_DIR, chapterName);
      const targetChapterPath = path.join(TARGET_DOCS_DIR, chapterName);

      fs.mkdirSync(targetChapterPath, { recursive: true });

      // Copy assets if exists
      const srcAssetsPath = path.join(srcChapterPath, 'assets');
      const targetAssetsPath = path.join(targetChapterPath, 'assets');
      if (fs.existsSync(srcAssetsPath)) {
        fs.mkdirSync(targetAssetsPath, { recursive: true });
        const assetFiles = fs.readdirSync(srcAssetsPath);
        for (const af of assetFiles) {
          fs.copyFileSync(path.join(srcAssetsPath, af), path.join(targetAssetsPath, af));
        }
      }

      // Read and process markdown files
      const mdFiles = fs.readdirSync(srcChapterPath)
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const chapterPages = [];

      for (const file of mdFiles) {
        const srcFilePath = path.join(srcChapterPath, file);
        const raw = fs.readFileSync(srcFilePath, 'utf-8');

        // Extract H1 title
        let title = '';
        const lines = raw.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('# ')) {
            title = trimmed.slice(2).trim();
            break;
          }
        }
        if (!title) {
          title = file.replace(/\.md$/i, '');
        }

        // Generate slug
        const slug = cleanSlug(file);
        const targetFilePath = path.join(targetChapterPath, `${slug}.md`);

        const finalContent = processMarkdownContent(raw, title);
        fs.writeFileSync(targetFilePath, finalContent, 'utf-8');
        chapterPages.push(slug);
      }

      // Write chapter meta.json
      const chapterMeta = {
        title: chapterName,
        pages: chapterPages,
      };
      fs.writeFileSync(
        path.join(targetChapterPath, 'meta.json'),
        JSON.stringify(chapterMeta, null, 2) + '\n',
        'utf-8'
      );

      importedChapterSlugs.push(chapterName);
      console.log(`✓ Processed ${chapterName}: ${chapterPages.length} docs`);
    } catch (err) {
      console.error(`Error processing chapter ${chapterName}:`, err);
      throw err;
    }
  }

  // Update root content/docs/meta.json
  const rootMetaPath = path.join(TARGET_DOCS_DIR, 'meta.json');
  let existingPages = [];
  if (fs.existsSync(rootMetaPath)) {
    try {
      const rootMeta = JSON.parse(fs.readFileSync(rootMetaPath, 'utf-8'));
      existingPages = rootMeta.pages || [];
    } catch {}
  }

  // Keep existing extra categories at the end
  const extraPages = existingPages.filter(p => !importedChapterSlugs.includes(p));
  const newRootPages = [...importedChapterSlugs, ...extraPages];

  fs.writeFileSync(
    rootMetaPath,
    JSON.stringify({ title: '目录', pages: newRootPages }, null, 2) + '\n',
    'utf-8'
  );

  console.log('--- All chapters imported successfully! ---');
  console.log(`Total chapters: ${importedChapterSlugs.length}`);
}

run().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
