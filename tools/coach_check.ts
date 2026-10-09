// Runs recorded hand tracks through the lesson's scoring, without a browser or a camera.
// Use it to see what a recording would score and which messages it would trigger, and to
// re-tune DEFAULT_CONFIG in src/cv/motion.ts after re-recording the reference.
//
//   node tools/coach_check.ts                         # every tools/fixtures/*.track.json, then what-if takes
//   node tools/coach_check.ts path/to/take.track.json # one track
//
// Tracks come from: python tools/extract_reference.py <recording> <out>.track.json --raw
//
// The what-if takes are made from take-paced by changing only its timing: slower, later, stopped
// half-way and so on. They show what the extra time after the clip does to a take.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
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
const STEP_MS = 1000 / 30;

interface TrackFile {
  frames: Array<{ t: number } & HandsFrame>;
}

type Take = Array<{ t: number; m: HandsMeasure | null }>;

function load(path: string): Take {
  const track = JSON.parse(readFileSync(path, 'utf8')) as TrackFile;
  return track.frames.map((f) => ({ t: f.t, m: measureHands(f, aspect) }));
}

/** Plays a take through the scorer as the app does: the clip, then the extra time until the learner has finished. */
function check(name: string, take: Take): void {
  // The recording starts with the lesson clip; the start pose is whatever its first frames show.
  const ready = take.slice(0, 3).map((x) => x.m).filter((m): m is HandsMeasure => m !== null);
  const scorer = new TakeScorer(reference);
  scorer.begin(ready);

  const clipMs = reference.durationMs;
  const last = take[take.length - 1];
  let endMs = clipMs + DEFAULT_CONFIG.extraMs;
  const timeline: Array<{ from: number; code: LiveCode }> = [];
  for (let i = 0; ; i++) {
    // After its last frame a recording stands still, as a paused one does in the app.
    const frame = i < take.length ? take[i] : { t: last.t + (i - take.length + 1) * STEP_MS, m: last.m };
    if (frame.t > clipMs + DEFAULT_CONFIG.extraMs) break;
    const code = scorer.push(frame.t, frame.m);
    if (timeline.length === 0 || timeline[timeline.length - 1].code !== code) timeline.push({ from: frame.t, code });
    if (frame.t > clipMs && scorer.finished(frame.t)) {
      endMs = frame.t;
      break;
    }
  }
  const result = scorer.finish(endMs);
  const shown = timeline.map((x) => `${(x.from / 1000).toFixed(1)}s ${x.code}`).join('  ->  ');
  const score = result.score === null ? result.reason : `${result.score}%`;
  console.log(
    `${name.padEnd(34)} ${score.padEnd(12)} take ${(endMs / 1000).toFixed(1)}s   coverage ${(result.coverage * 100).toFixed(0)}%`,
  );
  console.log(`    ${shown}`);
}

/** A take with the same hands at other moments: at take time t it shows what the source showed at `at(t)`; null hides the hands. */
function retime(source: Take, lengthMs: number, at: (t: number) => number | null): Take {
  const mix = (a: number, b: number, k: number) => a + (b - a) * k;
  const out: Take = [];
  for (let t = 0; t <= lengthMs; t += STEP_MS) {
    const moment = at(t);
    if (moment === null) {
      out.push({ t, m: null });
      continue;
    }
    const position = Math.min(Math.max(moment / STEP_MS, 0), source.length - 1);
    const a = source[Math.floor(position)].m;
    const b = source[Math.min(source.length - 1, Math.floor(position) + 1)].m;
    const k = position - Math.floor(position);
    out.push({
      t,
      m:
        a && b
          ? {
              left: [mix(a.left[0], b.left[0], k), mix(a.left[1], b.left[1], k)],
              right: [mix(a.right[0], b.right[0], k), mix(a.right[1], b.right[1], k)],
              midY: mix(a.midY, b.midY, k),
              gap: mix(a.gap, b.gap, k),
              tilt: mix(a.tilt, b.tilt, k),
              size: mix(a.size, b.size, k),
            }
          : (a ?? b),
    });
  }
  return out;
}

console.log(
  `reference: ${reference.rise.length} frames, total rise ${reference.totalRise.toFixed(2)} hand sizes, ` +
    `gap ${Math.min(...reference.gapRatio).toFixed(2)}-${Math.max(...reference.gapRatio).toFixed(2)}, ` +
    `tilt change ${Math.min(...reference.tiltChange).toFixed(2)}..${Math.max(...reference.tiltChange).toFixed(2)}; ` +
    `a take may last ${((reference.durationMs + DEFAULT_CONFIG.extraMs) / 1000).toFixed(1)} s\n`,
);
const args = process.argv.slice(2);
const fixtures = join(root, 'tools/fixtures');
const paths = args.length
  ? args
  : readdirSync(fixtures)
      .filter((name) => name.endsWith('.track.json'))
      .sort()
      .map((name) => join(fixtures, name));
for (const path of paths) check(basename(path).replace('.track.json', ''), load(path));

if (!args.length) {
  const paced = load(join(fixtures, 'take-paced.track.json'));
  const clip = reference.durationMs;
  const whole = clip + DEFAULT_CONFIG.extraMs;
  console.log('\nwhat-if takes, made from take-paced:');
  check('1.5 times slower', retime(paced, whole, (t) => t / 1.5));
  check('twice as slow', retime(paced, whole, (t) => t / 2));
  check('three times as slow (too slow)', retime(paced, whole, (t) => t / 3));
  check('starts 2 s late', retime(paced, whole, (t) => t - 2000));
  check('watches the clip, then does it', retime(paced, whole, (t) => t - clip));
  check('3 s late and 1.3 times slower', retime(paced, whole, (t) => (t - 3000) / 1.3));
  check('pauses 1 s half-way', retime(paced, whole, (t) => (t < 2800 ? t : t < 3800 ? 2800 : t - 1000)));
  check('stops half-way', retime(paced, whole, (t) => Math.min(t, 2800)));
  check('waits 4 s, then rushes (x1.5)', retime(paced, whole, (t) => (t - 4000) * 1.5));
  check('lowers the hands at the end', retime(paced, whole, (t) => (t < 5700 ? t : 5700 - (t - 5700) * 2)));
  check('takes the hands away at the end', retime(paced, whole, (t) => (t < 5700 ? t : null)));
  check('hands away for the last 2 s of clip', retime(paced, whole, (t) => (t < 3600 ? t : null)));
}
