// Copies the MediaPipe wasm runtime next to the app so the demo never loads it from a CDN.
// The wasm files must come from the same install as the JS bundle, so this runs on every `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(from)) {
  console.warn('copy-mediapipe: @mediapipe/tasks-vision is not installed yet, skipping');
} else {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log('copy-mediapipe: wasm runtime copied to public/mediapipe/wasm');
}
