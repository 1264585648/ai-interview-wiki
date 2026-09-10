import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ASSETS_ROOT = path.resolve('content/docs');

function findImages(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findImages(fullPath));
    } else if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const origStat = fs.statSync(filePath);
  const origSize = origStat.size;

  try {
    const transformer = sharp(filePath).resize({
      width: 1600,
      withoutEnlargement: true,
    });

    let buf;
    if (ext === '.png') {
      buf = await transformer.png({
        quality: 80,
        palette: true,
        compressionLevel: 9,
      }).toBuffer();
    } else if (ext === '.jpg' || ext === '.jpeg') {
      buf = await transformer.jpeg({
        quality: 80,
        mozjpeg: true,
      }).toBuffer();
    } else if (ext === '.webp') {
      buf = await transformer.webp({
        quality: 80,
      }).toBuffer();
    }

    if (buf && buf.length < origSize) {
      fs.writeFileSync(filePath, buf);
      return { filePath, origSize, newSize: buf.length, optimized: true };
    }
    return { filePath, origSize, newSize: origSize, optimized: false };
  } catch (err) {
    console.error('Error optimizing', filePath, err.message);
    return { filePath, origSize, newSize: origSize, optimized: false };
  }
}

async function main() {
  const images = findImages(ASSETS_ROOT);
  console.log(`Found ${images.length} images to optimize in ${ASSETS_ROOT}`);

  let totalOrig = 0;
  let totalNew = 0;
  let optimizedCount = 0;

  const CONCURRENCY = 8;
  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const batch = images.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(optimizeImage));
    for (const r of results) {
      totalOrig += r.origSize;
      totalNew += r.newSize;
      if (r.optimized) optimizedCount++;
    }
    if ((i + CONCURRENCY) % 80 === 0 || i + CONCURRENCY >= images.length) {
      console.log(`Progress: ${Math.min(i + CONCURRENCY, images.length)}/${images.length} | Current size: ${(totalNew / 1024 / 1024).toFixed(1)}MB / ${(totalOrig / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  console.log('--- Optimization Finished ---');
  console.log(`Total images: ${images.length}`);
  console.log(`Optimized images: ${optimizedCount}`);
  console.log(`Original size: ${(totalOrig / 1024 / 1024).toFixed(2)} MB`);
  console.log(`New size: ${(totalNew / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Reduction: ${((1 - totalNew / totalOrig) * 100).toFixed(1)}%`);
}

main();
