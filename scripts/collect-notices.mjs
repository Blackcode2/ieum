// Writes public/THIRD-PARTY-NOTICES.txt: the licences of the software and fonts that end up in the
// built site. They are copied from the installed packages on every `npm install`, so the notices
// cannot drift from what is shipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Everything the browser receives: the dependencies in package.json, and scheduler, which react-dom brings.
const PACKAGES = [
  'react',
  'react-dom',
  'scheduler',
  'three',
  '@mediapipe/tasks-vision',
  'pretendard',
  '@fontsource-variable/inter',
  '@fontsource-variable/noto-sans-kr',
];
const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
const rule = '='.repeat(78);

const parts = ['Software and fonts included in this site, with their licences.\n'];
let found = 0;
for (const name of PACKAGES) {
  const folder = join(root, 'node_modules', name);
  if (!existsSync(join(folder, 'package.json'))) continue;
  found++;
  const info = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const file = LICENCE_FILES.map((candidate) => join(folder, candidate)).find(existsSync);
  parts.push(`${rule}\n${name} ${info.version}: ${info.license ?? 'licence not stated in the package'}\n${rule}\n`);
  parts.push(
    file
      ? `${readFileSync(file, 'utf8').trim()}\n`
      : `The package carries no licence file. Its package.json names the licence above; the text is at https://spdx.org/licenses/${info.license}.html\n`,
  );
}

if (found === 0) {
  console.warn('collect-notices: packages are not installed yet, skipping');
} else {
  writeFileSync(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), parts.join('\n'));
  console.log(`collect-notices: licences of ${found} packages written to public/THIRD-PARTY-NOTICES.txt`);
}
