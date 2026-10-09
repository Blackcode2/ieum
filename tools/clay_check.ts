// Runs recorded hand tracks through the virtual clay, without a browser or a camera, and draws
// what the pot would look like over time. Use it to tune CLAY_CONFIG in src/cv/clay.ts.
//
//   node tools/clay_check.ts [out.svg]      # every tools/fixtures/*.track.json plus the reference
//
// The picture shows, per track, the pot's outline at eight moments with the two hand centres.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Clay, shapeScore, type ClayShape } from '../src/cv/clay.ts';
import { START_FRAMES, measureHands, type HandsFrame, type HandsMeasure } from '../src/cv/motion.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LESSON_MS = 5633;
const MOMENTS = 8;

interface TrackFile {
  view: { aspect: number };
  frames: Array<{ t: number } & HandsFrame>;
}

interface Run {
  name: string;
  snapshots: Array<{ t: number; shape: ClayShape; measure: HandsMeasure | null }>;
  final: ClayShape;
  thinFrames: number;
  touchFrames: number;
  frames: number;
}

/** `startFrames`: how many frames at the start stand in for the start pose. */
function run(name: string, path: string, startFrames: number): Run {
  const track = JSON.parse(readFileSync(path, 'utf8')) as TrackFile;
  const frames = track.frames.filter((f) => f.t <= LESSON_MS);
  const measures = frames.map((f) => measureHands(f, track.view.aspect));
  const clay = new Clay();
  clay.fit(measures.slice(0, startFrames).filter((m): m is HandsMeasure => m !== null));

  const out: Run = { name, snapshots: [], final: clay.shape(), thinFrames: 0, touchFrames: 0, frames: frames.length };
  const every = Math.max(1, Math.floor(frames.length / (MOMENTS - 1)));
  frames.forEach((frame, i) => {
    clay.press(measures[i], frame.t);
    const shape = clay.shape();
    if (shape.tooThin) out.thinFrames++;
    if (shape.touching) out.touchFrames++;
    if (i % every === 0 && out.snapshots.length < MOMENTS - 1) {
      out.snapshots.push({ t: frame.t, shape: { ...shape, radii: [...shape.radii] }, measure: measures[i] });
    }
  });
  out.final = { ...clay.shape(), radii: [...clay.shape().radii] };
  out.snapshots.push({ t: frames[frames.length - 1]?.t ?? 0, shape: out.final, measure: measures[measures.length - 1] ?? null });
  return out;
}

const fixtures = join(root, 'tools/fixtures');
const tracks: Array<[string, string]> = [['reference', join(root, 'public/lesson/reference.json')]];
for (const file of readdirSync(fixtures).filter((n) => n.endsWith('.track.json')).sort()) {
  tracks.push([basename(file, '.track.json'), join(fixtures, file)]);
}
// The reference is fitted as the app fits its model pot; a take starts from the frame the recording is paused on.
const runs = tracks.map(([name, path], i) => run(name, path, i === 0 ? START_FRAMES : 3));
const model = runs[0].final;

// ---- numbers -------------------------------------------------------------------------------------
console.log('track              height start->end (x)       wall narrowest..widest   wall left   touching   too thin   모양 일치도');
for (const r of runs) {
  if (!r.final.radii.length) {
    console.log(`${r.name.padEnd(18)} no lump placed (hands never seen)`);
    continue;
  }
  const f = r.final;
  const narrow = Math.min(...f.radii) / f.startRadius;
  const wide = Math.max(...f.radii) / f.startRadius;
  const startWall = 0.4 * f.startRadius;
  console.log(
    `${r.name.padEnd(18)} ${f.startHeight.toFixed(3)} -> ${f.height.toFixed(3)} (x${(f.height / f.startHeight).toFixed(2)})`.padEnd(47) +
      `${narrow.toFixed(2)}..${wide.toFixed(2)}`.padEnd(25) +
      `x${(f.wall / startWall).toFixed(2)}`.padEnd(12) +
      `${((100 * r.touchFrames) / r.frames).toFixed(0)}%`.padEnd(11) +
      `${((100 * r.thinFrames) / r.frames).toFixed(0)}%`.padEnd(11) +
      `${shapeScore(f, model)}%`,
  );
}

// ---- picture -------------------------------------------------------------------------------------
const CELL_W = 190;
const CELL_H = 190;
const LABEL = 150;
const visible = runs.filter((r) => r.final.radii.length);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL + MOMENTS * CELL_W}" height="${visible.length * CELL_H + 10}" font-family="sans-serif" font-size="12">`;
svg += `<rect width="100%" height="100%" fill="#1b1b1b"/>`;
visible.forEach((r, row) => {
  const y0 = row * CELL_H + 5;
  svg += `<text x="8" y="${y0 + 20}" fill="#fff" font-size="14">${r.name}</text>`;
  svg += `<text x="8" y="${y0 + 40}" fill="#aaa">모양 ${shapeScore(r.final, model)}%</text>`;
  r.snapshots.forEach((snap, col) => {
    const x0 = LABEL + col * CELL_W;
    const s = snap.shape;
    // The whole tracked view (1.116 x 1 view heights) fits one cell.
    const k = (CELL_H - 10) / 1;
    const px = (x: number) => x0 + x * k;
    const py = (y: number) => y0 + y * k;
    svg += `<rect x="${x0}" y="${y0}" width="${1.116 * k}" height="${k}" fill="#2a2a2a"/>`;
    const right: string[] = [];
    const left: string[] = [];
    const step = s.height / s.radii.length;
    s.radii.forEach((radius, i) => {
      const y = s.baseY - (i + 0.5) * step;
      right.push(`${px(s.axisX + radius).toFixed(1)},${py(y).toFixed(1)}`);
      left.unshift(`${px(s.axisX - radius).toFixed(1)},${py(y).toFixed(1)}`);
    });
    svg += `<polygon points="${[...right, ...left].join(' ')}" fill="#cfc6b8" stroke="#8f8576"/>`;
    // The opening at the rim shows how thin the wall has become.
    const rim = s.radii[s.radii.length - 1];
    const rimY = py(s.baseY - s.height);
    svg += `<line x1="${px(s.axisX - Math.max(0, rim - s.wall))}" y1="${rimY}" x2="${px(s.axisX + Math.max(0, rim - s.wall))}" y2="${rimY}" stroke="#5a5247" stroke-width="3"/>`;
    svg += `<line x1="${px(s.axisX - s.startRadius * 1.6)}" y1="${py(s.baseY)}" x2="${px(s.axisX + s.startRadius * 1.6)}" y2="${py(s.baseY)}" stroke="#888" stroke-width="3"/>`;
    if (snap.measure) {
      for (const hand of [snap.measure.left, snap.measure.right]) {
        svg += `<circle cx="${px(hand[0])}" cy="${py(hand[1])}" r="${snap.measure.size * 1.25 * k}" fill="rgba(250,57,38,0.25)" stroke="#fa3926"/>`;
      }
    }
    svg += `<text x="${x0 + 4}" y="${y0 + 14}" fill="#ddd">${(snap.t / 1000).toFixed(1)}s</text>`;
  });
});
svg += '</svg>';
const out = process.argv[2];
if (out) {
  writeFileSync(out, svg);
  console.log(`\nwrote ${out}`);
}
