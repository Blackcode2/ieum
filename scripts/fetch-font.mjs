// Downloads the logo font (신라문화체 M, © 경주시) when it is not there yet.
// The font may be used freely, including as a web font, but must not be redistributed or modified,
// so it is kept out of the repository and fetched unmodified at install time instead.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2206-02@1.0/Shilla_CultureM-Medium.woff2';
const SHA256 = 'fe74760577213f55ce62805c6aee9291f35c72883d9c4dcc5f0dad64d04923b6';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'fonts', 'Shilla_CultureM-Medium.woff2');

if (existsSync(target)) {
  console.log('fetch-font: logo font already present');
} else {
  try {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== SHA256) throw new Error(`unexpected file (sha256 ${digest})`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log('fetch-font: logo font downloaded');
  } catch (error) {
    // The site still works without it; the logo falls back to a serif face.
    console.warn(`fetch-font: could not download the logo font (${error.message})`);
  }
}
