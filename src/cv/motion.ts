// Pure motion maths for the lesson: what is measured from two tracked hands, how a take is compared
// with the reference motion, which live feedback follows from it, and the final 동작 일치도.
// No DOM and no imports besides types, so tools/coach_check.ts can run it in Node on recorded tracks.
import type { SessionResult } from './types';

export type Point = readonly [number, number];

/** 21 landmarks per hand, normalised to the tracked view (x right, y down). Left / right = side of the picture. */
export interface HandsFrame {
  left: ReadonlyArray<Point> | null;
  right: ReadonlyArray<Point> | null;
}

/**
 * What the lesson looks at. Lengths are in view-height units (x is multiplied by the view's aspect).
 * The grip in this lesson points the palm at the camera, so the tracker has to guess the wrist and the
 * base of the thumb: they sit on the wrong side of the knuckles and jump between frames, and the
 * wrist-to-knuckle length varies by 12-34% over a take. The other 18 points sit on the hand. Their
 * centroid and mean spread were the steadiest centre and size on the team's recordings (about 1 px
 * of jitter, about 3% variation over a take).
 */
export interface HandsMeasure {
  left: Point;
  right: Point;
  /** Mean height of the two hand centres. */
  midY: number;
  /** Distance between the two hand centres. */
  gap: number;
  /** Left centre height minus right centre height. */
  tilt: number;
  /** Hand size: mean distance of those points from their centroid, averaged over both hands. */
  size: number;
}

/** Landmarks 3..20: everything except the wrist (0) and the thumb base (1, 2). */
const RELIABLE_POINTS = Array.from({ length: 18 }, (_, i) => i + 3);

function centreAndSpread(points: ReadonlyArray<Point>, aspect: number): { centre: Point; spread: number } {
  let cx = 0;
  let cy = 0;
  for (const i of RELIABLE_POINTS) {
    cx += points[i][0] * aspect;
    cy += points[i][1];
  }
  cx /= RELIABLE_POINTS.length;
  cy /= RELIABLE_POINTS.length;
  let spread = 0;
  for (const i of RELIABLE_POINTS) spread += Math.hypot(points[i][0] * aspect - cx, points[i][1] - cy);
  return { centre: [cx, cy], spread: spread / RELIABLE_POINTS.length };
}

export function measureHands(frame: HandsFrame, aspect: number): HandsMeasure | null {
  if (!frame.left || !frame.right) return null;
  const left = centreAndSpread(frame.left, aspect);
  const right = centreAndSpread(frame.right, aspect);
  // Two centres closer than one hand size: the tracker reported one hand twice.
  if (Math.hypot(left.centre[0] - right.centre[0], left.centre[1] - right.centre[1]) < (left.spread + right.spread) / 2) return null;
  return {
    left: left.centre,
    right: right.centre,
    midY: (left.centre[1] + right.centre[1]) / 2,
    gap: Math.hypot(left.centre[0] - right.centre[0], left.centre[1] - right.centre[1]),
    tilt: left.centre[1] - right.centre[1],
    size: (left.spread + right.spread) / 2,
  };
}

// ---------------------------------------------------------------------------------------------------
// Reference motion

export interface ReferenceFile {
  version: number;
  view: { aspect: number };
  lesson: { fps: number; frameCount: number; durationMs: number };
  frames: ReadonlyArray<{ t: number; left: number[][] | null; right: number[][] | null }>;
}

/** The reference take reduced to the three curves the lesson compares, one value per lesson frame. */
export interface ReferenceMotion {
  durationMs: number;
  stepMs: number;
  /** How far the hands have risen since the start, in hand sizes. */
  rise: number[];
  /** Hand-to-hand distance relative to the start pose. */
  gapRatio: number[];
  /** Change of the left-right height difference since the start, in hand sizes. */
  tiltChange: number[];
  totalRise: number;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Centred moving average; the reference is smoothed without lag, the live take is left raw. */
function smooth(values: ReadonlyArray<number>, radius: number): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let k = from; k <= to; k++) sum += values[k];
    return sum / (to - from + 1);
  });
}

/** The first 0.3 s of the reference stand in for its start pose. */
const START_FRAMES = 9;

export function buildReference(file: ReferenceFile): ReferenceMotion {
  const aspect = file.view.aspect;
  const measures: HandsMeasure[] = [];
  let last: HandsMeasure | null = null;
  for (const frame of file.frames) {
    const m: HandsMeasure | null = measureHands(frame as unknown as HandsFrame, aspect) ?? last;
    if (m) {
      measures.push(m);
      last = m;
    }
  }
  if (measures.length < START_FRAMES * 2) throw new Error('reference motion has too few tracked frames');

  // Size and start position come from the start pose, exactly as they do for the learner: the hand
  // turns as it rises, so a size taken over the whole take would not be the same measure.
  const start = measures.slice(0, START_FRAMES);
  const size = median(start.map((m) => m.size));
  const anchorY = median(start.map((m) => m.midY));
  const gap0 = median(start.map((m) => m.gap));
  const tilt0 = median(start.map((m) => m.tilt));

  const rise = smooth(measures.map((m) => (anchorY - m.midY) / size), 2);
  return {
    durationMs: file.lesson.durationMs,
    stepMs: 1000 / file.lesson.fps,
    rise,
    gapRatio: smooth(measures.map((m) => m.gap / gap0), 2),
    tiltChange: smooth(measures.map((m) => (m.tilt - tilt0) / size), 2),
    totalRise: median(rise.slice(-START_FRAMES)),
  };
}

function curveAt(curve: ReadonlyArray<number>, stepMs: number, tMs: number): number {
  const pos = Math.min(Math.max(tMs / stepMs, 0), curve.length - 1);
  const i = Math.floor(pos);
  const next = Math.min(i + 1, curve.length - 1);
  return curve[i] + (curve[next] - curve[i]) * (pos - i);
}

// ---------------------------------------------------------------------------------------------------
// Scoring a take

export interface CoachConfig {
  /** No judgement during the first moments: a time shift and a height offset look the same there. */
  followMs: number;
  /** A follower is always a little behind the video; being this late is not "slow". */
  lagAllowMs: number;
  /** Ahead of the artisan by this share of the whole rise: too fast. */
  fastLead: number;
  /** Behind (after the lag allowance) by this share of the whole rise: too slow. */
  slowLag: number;
  /** Rise over the last second, relative to the reference's: beyond these the pace is off. */
  fastRatio: number;
  slowRatio: number;
  /** Hands drifting apart or together, relative to their own start distance. */
  gapTol: number;
  /** One hand moving above the other, in hand sizes. */
  tiltTol: number;
  /** Jitter of the hand centres around a straight path over the last half second, in hand sizes. */
  shakeTol: number;
  /** Both hands unseen for this long: say so. */
  lostMs: number;
  /** A problem must last this long before it is shown, and a message stays at least minShowMs. */
  badHoldMs: number;
  goodHoldMs: number;
  minShowMs: number;
  /** Final score. */
  minCoverage: number;
  minTravel: number;
  errorFree: number;
  errorZero: number;
  gapWeight: number;
  /** Score from which the result is shown as good. */
  goodScore: number;
}

// Starting values, tuned on the team's own recordings with tools/coach_check.ts. They should be
// re-checked whenever the reference take, the camera position or the lesson changes.
export const DEFAULT_CONFIG: CoachConfig = {
  followMs: 900,
  lagAllowMs: 300,
  fastLead: 0.13,
  slowLag: 0.16,
  fastRatio: 1.45,
  slowRatio: 0.5,
  gapTol: 0.22,
  tiltTol: 0.9,
  shakeTol: 0.09,
  lostMs: 350,
  badHoldMs: 350,
  goodHoldMs: 300,
  minShowMs: 700,
  minCoverage: 0.6,
  minTravel: 0.4,
  errorFree: 0.02,
  errorZero: 0.16,
  gapWeight: 0.2,
  goodScore: 75,
};

export type LiveCode =
  | 'follow'
  | 'steady'
  | 'too-fast'
  | 'too-slow'
  | 'hands-apart'
  | 'hands-close'
  | 'hands-uneven'
  | 'shaky'
  | 'hands-lost';

interface Sample {
  t: number;
  rise: number;
  gapRatio: number;
  tiltChange: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

const SCALES = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25];
const LAGS_MS = [0, 100, 200, 300];
const SPEED_WINDOW_MS = 1000;
const SHAKE_WINDOW_MS = 500;

/** Scores one play-through of the lesson: live feedback per camera frame, and a final result. */
export class TakeScorer {
  private readonly samples: Sample[] = [];
  private unit = 0;
  private anchorY = 0;
  private gap0 = 0;
  private tilt0 = 0;
  private riseOffset = 0;
  private anchored = false;
  private frames = 0;
  private tracked = 0;
  private judged = 0;
  private faulty = 0;
  private lastSeenMs = 0;
  private shown: LiveCode = 'follow';
  private shownSince = 0;
  private candidate: LiveCode = 'follow';
  private candidateSince = 0;
  private readonly reference: ReferenceMotion;
  private readonly config: CoachConfig;

  constructor(reference: ReferenceMotion, config: CoachConfig = DEFAULT_CONFIG) {
    this.reference = reference;
    this.config = config;
  }

  /** `ready` are measurements taken while the learner held the start pose, just before the clip starts. */
  begin(ready: ReadonlyArray<HandsMeasure>): void {
    if (ready.length === 0) return;
    this.unit = median(ready.map((m) => m.size));
    this.anchorY = median(ready.map((m) => m.midY));
    this.gap0 = median(ready.map((m) => m.gap));
    this.tilt0 = median(ready.map((m) => m.tilt));
    this.anchored = true;
  }

  /** Feed one camera frame at lesson time tMs. Returns the feedback to show now. */
  push(tMs: number, measure: HandsMeasure | null): LiveCode {
    this.frames++;
    if (!measure) {
      const lost = tMs - this.lastSeenMs > this.config.lostMs;
      return this.decide(tMs, lost ? 'hands-lost' : this.candidate);
    }
    this.tracked++;
    this.lastSeenMs = tMs;
    if (!this.anchored) {
      // The hands only appeared after the clip started: anchor here, on the reference's curve.
      this.begin([measure]);
      this.riseOffset = this.refRise(tMs);
      this.gap0 /= this.refAt(this.reference.gapRatio, tMs);
      this.tilt0 -= this.refAt(this.reference.tiltChange, tMs) * this.unit;
    }
    this.samples.push({
      t: tMs,
      rise: (this.anchorY - measure.midY) / this.unit + this.riseOffset,
      gapRatio: measure.gap / this.gap0,
      tiltChange: (measure.tilt - this.tilt0) / this.unit,
      lx: measure.left[0] / this.unit,
      ly: measure.left[1] / this.unit,
      rx: measure.right[0] / this.unit,
      ry: measure.right[1] / this.unit,
    });
    const raw = this.judge(tMs);
    if (raw !== 'follow') {
      this.judged++;
      if (raw !== 'steady') this.faulty++;
    }
    return this.decide(tMs, raw);
  }

  finish(): SessionResult {
    const coverage = this.frames ? this.tracked / this.frames : 0;
    if (coverage < this.config.minCoverage || this.samples.length < 10) {
      return { score: null, reason: 'not-tracked', coverage };
    }
    const total = this.reference.totalRise;
    const rises = this.samples.map((s) => s.rise).sort((a, b) => a - b);
    const travel = rises[Math.floor(rises.length * 0.95)];
    if (travel < this.config.minTravel * total) return { score: null, reason: 'no-movement', coverage };
    // Lesson time after the last tracked frame counts as the hands standing still there.
    const scored = [...this.samples];
    const lastSample = scored[scored.length - 1];
    for (let t = lastSample.t + this.reference.stepMs; t <= this.reference.durationMs; t += this.reference.stepMs) scored.push({ ...lastSample, t });

    // Compare how the rise unfolds over time. A learner's hand size and reach differ a little from the
    // reference's, so the best overall scale within +-25% is allowed, as is following up to 0.3 s late.
    let error = Infinity;
    for (const scale of SCALES) {
      let sum = 0;
      for (const s of scored) {
        const progress = s.rise / (scale * total);
        let best = Infinity;
        for (const lag of LAGS_MS) best = Math.min(best, Math.abs(progress - this.refRise(s.t - lag) / total));
        sum += best;
      }
      error = Math.min(error, sum / scored.length + 0.05 * Math.abs(Math.log(scale)));
    }
    const { errorFree, errorZero, gapTol, gapWeight } = this.config;
    const progressScore = clamp01(1 - (error - errorFree) / (errorZero - errorFree));

    let gapError = 0;
    for (const s of this.samples) {
      gapError += Math.max(0, Math.abs(s.gapRatio - this.refAt(this.reference.gapRatio, s.t)) - gapTol / 2);
    }
    const gapScore = clamp01(1 - gapError / this.samples.length / gapTol);

    // The share of the take spent on a red message costs up to half the score, so the result never
    // contradicts what the pill was saying during the take.
    const form = this.judged ? 1 - 0.5 * (this.faulty / this.judged) : 1;
    const score = Math.round(100 * progressScore * (1 - gapWeight + gapWeight * gapScore) * form);
    if (!Number.isFinite(score)) return { score: null, reason: 'not-tracked', coverage };
    return { score, reason: 'ok', coverage };
  }

  private judge(tMs: number): LiveCode {
    const c = this.config;
    if (tMs < c.followMs) return 'follow';
    const total = this.reference.totalRise;
    const now = this.samples[this.samples.length - 1];
    const progress = now.rise / total;
    const lead = progress - this.refRise(tMs) / total;
    const behind = this.refRise(tMs - c.lagAllowMs) / total - progress;

    const past = this.sampleNear(tMs - SPEED_WINDOW_MS);
    let ratio = 1;
    const refSpeed = this.refRise(tMs) - this.refRise(tMs - SPEED_WINDOW_MS);
    if (past && refSpeed > 0.1 * total * (SPEED_WINDOW_MS / this.reference.durationMs)) {
      ratio = ((now.rise - past.rise) / (now.t - past.t)) / (refSpeed / SPEED_WINDOW_MS);
    }
    // Pace alone only counts when the learner is not already on the other side of the artisan.
    if (lead > c.fastLead || (ratio > c.fastRatio && lead > -0.02)) return 'too-fast';
    if (behind > c.slowLag || (ratio < c.slowRatio && lead < 0.02)) return 'too-slow';

    const gapError = now.gapRatio - this.refAt(this.reference.gapRatio, tMs);
    if (gapError > c.gapTol) return 'hands-apart';
    if (gapError < -c.gapTol) return 'hands-close';
    if (Math.abs(now.tiltChange - this.refAt(this.reference.tiltChange, tMs)) > c.tiltTol) return 'hands-uneven';
    if (this.shake(tMs) > c.shakeTol) return 'shaky';
    return 'steady';
  }

  /** Root-mean-square distance of the hand centres from a straight path over the last half second. */
  private shake(tMs: number): number {
    const all = this.samples.filter((s) => s.t >= tMs - SHAKE_WINDOW_MS);
    if (all.length < 7) return 0;
    // One bad tracker frame must not read as shaking: leave out whichever single frame fits worst.
    let least = Infinity;
    for (let skip = 0; skip < all.length; skip++) least = Math.min(least, this.spread(all.filter((_, i) => i !== skip)));
    return least;
  }

  private spread(window: Sample[]): number {
    const residual = (pick: (s: Sample) => number): number => {
      const n = window.length;
      let st = 0;
      let sv = 0;
      let stt = 0;
      let stv = 0;
      for (const s of window) {
        const v = pick(s);
        st += s.t;
        sv += v;
        stt += s.t * s.t;
        stv += s.t * v;
      }
      const slope = (n * stv - st * sv) / (n * stt - st * st || 1);
      const offset = (sv - slope * st) / n;
      let sum = 0;
      for (const s of window) sum += (pick(s) - (offset + slope * s.t)) ** 2;
      return sum / n;
    };
    const mean =
      (residual((s) => s.lx) + residual((s) => s.ly) + residual((s) => s.rx) + residual((s) => s.ry)) / 2;
    return Math.sqrt(mean);
  }

  private decide(tMs: number, candidate: LiveCode): LiveCode {
    const c = this.config;
    if (candidate !== this.candidate) {
      const isCalm = (code: LiveCode) => code === 'steady' || code === 'follow';
      if (isCalm(candidate) || isCalm(this.candidate)) this.candidateSince = tMs;
      this.candidate = candidate;
    }
    if (candidate === this.shown) return this.shown;
    const calm = candidate === 'steady' || candidate === 'follow';
    const held = tMs - this.candidateSince >= (calm ? c.goodHoldMs : c.badHoldMs);
    const shownLongEnough = this.shown === 'follow' || tMs - this.shownSince >= c.minShowMs;
    if (held && shownLongEnough) {
      this.shown = candidate;
      this.shownSince = tMs;
    }
    return this.shown;
  }

  private sampleNear(tMs: number): Sample | null {
    let best: Sample | null = null;
    for (const s of this.samples) {
      if (s.t > tMs + 150) break;
      best = s;
    }
    return best && Math.abs(best.t - tMs) <= 250 ? best : null;
  }

  private refRise(tMs: number): number {
    return this.refAt(this.reference.rise, tMs);
  }

  private refAt(curve: ReadonlyArray<number>, tMs: number): number {
    return curveAt(curve, this.reference.stepMs, tMs);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
