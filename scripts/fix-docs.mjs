import fs from 'fs';
import path from 'path';

const DOCS_DIR = path.resolve('content/docs');

// Shiki language map for unsupported or weird languages
const LANG_MAP = {
  'none': 'text',
  'env': 'bash',
  'dotenv': 'bash',
  'shell': 'bash',
  'code': 'text',
  'output': 'text',
  'log': 'text',
  'logs': 'text',
  'console': 'bash',
  'yml': 'yaml',
  'plain': 'text',
  'plaintext': 'text',
  'txt': 'text',
};

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // 1. Fix code block languages
  content = content.replace(/^```([a-zA-Z0-9_\-\.]+)/gm, (match, lang) => {
    const lower = lang.toLowerCase();
    if (LANG_MAP[lower]) {
      changed = true;
      return '```' + LANG_MAP[lower];
    }
    return match;
  });

  // 2. Convert remote HTTP/HTTPS images to <img /> to avoid remark-image network probes during build
  content = content.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (match, alt, src) => {
    changed = true;
    return `<img src="${src}" alt="${alt || ''}" />`;
  });

  // 3. Fix placeholder / invalid image references
  // e.g. ![](images/...) or ![](minioUrl)
  content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const trimmedSrc = src.trim();
    
    // Check if it's a dummy example.com URL
    if (trimmedSrc.includes('example.com') || trimmedSrc === 'minioUrl') {
      changed = true;
      return `\`[图片占位: ${alt || trimmedSrc}]\``;
    }

    // Check if relative path exists
    if (!trimmedSrc.startsWith('http://') && !trimmedSrc.startsWith('https://') && !trimmedSrc.startsWith('/')) {
      const targetPath = path.join(path.dirname(filePath), trimmedSrc);
      if (!fs.existsSync(targetPath)) {
        changed = true;
        return `\`[图片: ${alt || trimmedSrc}]\``;
      }
    }

    return match;
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  return changed;
}

function traverse(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += traverse(full);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      if (fixFile(full)) {
        count++;
        console.log(`Fixed: ${path.relative(DOCS_DIR, full)}`);
      }
    }
  }
  return count;
}

const fixedCount = traverse(DOCS_DIR);
console.log(`Finished fixing docs. Total files modified: ${fixedCount}`);
