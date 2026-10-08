// Runs recorded hand tracks through the lesson's scoring, without a browser or a camera.
// Use it to see what a recording would score and which messages it would trigger, and to
// re-tune DEFAULT_CONFIG in src/cv/motion.ts after re-recording the reference.
//
//   node tools/coach_check.ts                         # every tools/fixtures/*.track.json
//   node tools/coach_check.ts path/to/take.track.json # one track
//
// Tracks come from: python tools/extract_reference.py <recording> <out>.track.json --raw
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TakeScorer,
  buildReference,
  measureHands,
  type HandsFrame,
  type HandsMeasure,
  type LiveCode,
  type ReferenceFile,
} from '../src/cv/motion.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const referenceFile = JSON.parse(readFileSync(join(root, 'public/lesson/reference.json'), 'utf8')) as ReferenceFile;
const reference = buildReference(referenceFile);
const aspect = referenceFile.view.aspect;

interface TrackFile {
  frames: Array<{ t: number } & HandsFrame>;
}

function check(path: string): void {
  const track = JSON.parse(readFileSync(path, 'utf8')) as TrackFile;
  const measures = track.frames.map((f) => ({ t: f.t, m: measureHands(f, aspect) }));

  // The recording starts with the lesson clip; the start pose is whatever its first frames show.
  const ready = measures.slice(0, 3).map((x) => x.m).filter((m): m is HandsMeasure => m !== null);
  const scorer = new TakeScorer(reference);
  scorer.begin(ready);

  const timeline: Array<{ from: number; code: LiveCode }> = [];
  for (const { t, m } of measures) {
    if (t > reference.durationMs) break;
    const code = scorer.push(t, m);
    if (timeline.length === 0 || timeline[timeline.length - 1].code !== code) timeline.push({ from: t, code });
  }
  const result = scorer.finish();
  const shown = timeline.map((x) => `${(x.from / 1000).toFixed(1)}s ${x.code}`).join('  ->  ');
  const score = result.score === null ? result.reason : `${result.score}%`;
  console.log(`${basename(path).replace('.track.json', '').padEnd(18)} ${score.padEnd(12)} coverage ${(result.coverage * 100).toFixed(0)}%`);
  console.log(`    ${shown}`);
}

console.log(
  `reference: ${reference.rise.length} frames, total rise ${reference.totalRise.toFixed(2)} hand sizes, ` +
    `gap ${Math.min(...reference.gapRatio).toFixed(2)}-${Math.max(...reference.gapRatio).toFixed(2)}, ` +
    `tilt change ${Math.min(...reference.tiltChange).toFixed(2)}..${Math.max(...reference.tiltChange).toFixed(2)}\n`,
);
const args = process.argv.slice(2);
const fixtures = join(root, 'tools/fixtures');
const paths = args.length
  ? args
  : readdirSync(fixtures)
      .filter((name) => name.endsWith('.track.json'))
      .sort()
      .map((name) => join(fixtures, name));
paths.forEach(check);
