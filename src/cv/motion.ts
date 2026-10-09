// Pure motion maths for the lesson: what is measured from two tracked hands, how a take is compared
// with the reference motion, which live feedback follows from it, and the final 동작 일치도.
// No DOM and no imports besides types, so tools/coach_check.ts can run it in Node on recorded tracks.
import type { MotionResult } from './types';

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
  // One "hand" under half the other's size: the tracker lost it and is following something else.
  // (Seen at 0.26-0.28 when that happens; two real hands never went below 0.89 on the recordings.)
  if (Math.min(left.spread, right.spread) < 0.5 * Math.max(left.spread, right.spread)) return null;
  return {
    left: left.centre,
    right: right.centre,
    midY: (left.centre[1] + right.centre[1]) / 2,
    gap: Math.hypot(left.centre[0] - right.centre[0], left.centre[1] - right.centre[1]),
    tilt: left.centre[1] - right.centre[1],
    size: (left.spread + right.spread) / 2,
  };
}

/** True if neither hand's centre moved by more than `tolerance` hand sizes over these measurements. */
export function isSteady(pose: ReadonlyArray<HandsMeasure>, tolerance: number): boolean {
  if (pose.length < 2) return false;
  const size = pose.reduce((sum, m) => sum + m.size, 0) / pose.length;
  const moved = (pick: (m: HandsMeasure) => number): number => {
    let low = Infinity;
    let high = -Infinity;
    for (const m of pose) {
      const value = pick(m);
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return high - low;
  };
  return (
    Math.max(
      moved((m) => m.left[0]),
      moved((m) => m.left[1]),
      moved((m) => m.right[0]),
      moved((m) => m.right[1]),
    ) <=
    tolerance * size
  );
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
export const START_FRAMES = 9;

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
//
// The clip shows the movement once, at the artisan's pace. A take lasts longer than the clip: a
// learner may watch first, start later or rise more slowly, and is not marked down for it as long as
// the movement itself is the artisan's. What counts against a take is rushing, hands that drift
// apart or together, one hand above the other, shaking, and not getting to the top.

export interface CoachConfig {
  /** No judgement during the first moments: a time shift and a height offset look the same there. */
  followMs: number;
  /** A take may last this much longer than the clip, for a learner who is still on the way up. */
  extraMs: number;
  /** Rise, as a share of the whole, from which the learner counts as having started. */
  startProgress: number;
  /** Ahead of the artisan on the screen by this share of the whole rise: too fast. */
  fastLead: number;
  /** Rise over the last second, relative to the artisan's pace: beyond this the pace is too fast. */
  fastRatio: number;
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
  /**
   * After the clip the take ends as soon as the learner has finished: hands held still for restMs
   * near the top (from arriveProgress of the whole rise), or for pauseMs lower down, where it may
   * only be a pause; "still" is within restTravel of the whole rise. Hands that come down by
   * dropTravel of the whole rise, or leave the picture, have finished too.
   */
  restMs: number;
  pauseMs: number;
  arriveProgress: number;
  restTravel: number;
  dropTravel: number;
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
  extraMs: 7000,
  startProgress: 0.06,
  fastLead: 0.13,
  fastRatio: 1.45,
  gapTol: 0.22,
  tiltTol: 0.9,
  shakeTol: 0.09,
  lostMs: 350,
  badHoldMs: 350,
  goodHoldMs: 300,
  minShowMs: 700,
  restMs: 500,
  pauseMs: 1500,
  arriveProgress: 0.8,
  restTravel: 0.03,
  dropTravel: 0.08,
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
/** A follower reacts to what the artisan does: each moment may be this late against the fitted pace. */
const LAGS_MS = [0, 100, 200, 300];
/** The final comparison tries a later start in these steps, and these slower paces (1 is the artisan's). */
const START_STEP_MS = 250;
const STRETCHES = [1, 1.1, 1.2, 1.35, 1.5, 1.75, 2, 2.25];
/** The fitted movement has to be over when the take ends, give or take this much. */
const END_SLACK_MS = 300;
const SPEED_WINDOW_MS = 1000;
const SHAKE_WINDOW_MS = 500;

/** Scores one take of the lesson: live feedback per camera frame, and a final result. */
export class TakeScorer {
  private readonly samples: Sample[] = [];
  private unit = 0;
  private anchorY = 0;
  private gap0 = 0;
  private tilt0 = 0;
  private anchored = false;
  private frames = 0;
  private tracked = 0;
  private judged = 0;
  private faulty = 0;
  private lastSeenMs = 0;
  /** The highest the hands have been so far, in hand sizes above the start pose. */
  private peak = 0;
  private shown: LiveCode = 'follow';
  private shownSince = 0;
  private candidate: LiveCode = 'follow';
  private candidateSince = 0;
  private readonly reference: ReferenceMotion;
  private readonly config: CoachConfig;
  /** The reference's rise as it only ever goes up, so that a height can be looked up as a moment. */
  private readonly climb: number[];

  constructor(reference: ReferenceMotion, config: CoachConfig = DEFAULT_CONFIG) {
    this.reference = reference;
    this.config = config;
    let top = -Infinity;
    this.climb = reference.rise.map((rise) => (top = Math.max(top, rise)));
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

  /**
   * Feed one camera frame at take time tMs: the clip's own time while it plays, and counting on
   * after it has ended. Returns the feedback to show now.
   */
  push(tMs: number, measure: HandsMeasure | null): LiveCode {
    this.frames++;
    if (!measure) {
      const lost = tMs - this.lastSeenMs > this.config.lostMs;
      return this.decide(tMs, lost ? 'hands-lost' : this.candidate);
    }
    this.tracked++;
    this.lastSeenMs = tMs;
    // Without a start pose, the first sighting stands in for it.
    if (!this.anchored) this.begin([measure]);
    const rise = (this.anchorY - measure.midY) / this.unit;
    this.peak = Math.max(this.peak, rise);
    this.samples.push({
      t: tMs,
      rise,
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

  /**
   * After the clip, at take time tMs: has the learner finished? Yes once they have really moved and
   * then hold still, lower their hands or take them away. A learner who has not started keeps the
   * whole extra time.
   */
  finished(tMs: number): boolean {
    const c = this.config;
    const total = this.reference.totalRise;
    const last = this.samples[this.samples.length - 1];
    if (!last || this.peak < c.minTravel * total) return false;
    if (tMs - last.t > c.lostMs) return true;
    if (last.rise < this.peak - c.dropTravel * total) return true;

    const hold = last.rise >= c.arriveProgress * total ? c.restMs : c.pauseMs;
    let first = this.samples.length - 1;
    while (first > 0 && last.t - this.samples[first - 1].t <= hold) first--;
    // Tracked over most of that time, and never further from where the hands are now than "still".
    if (last.t - this.samples[first].t < 0.8 * hold) return false;
    for (let i = first; i < this.samples.length; i++) {
      if (Math.abs(this.samples[i].rise - last.rise) > c.restTravel * total) return false;
    }
    return true;
  }

  /** The result of a take that ended at take time endMs. */
  finish(endMs: number = this.reference.durationMs): MotionResult {
    const coverage = this.frames ? this.tracked / this.frames : 0;
    if (coverage < this.config.minCoverage || this.samples.length < 10) {
      return { score: null, reason: 'not-tracked', coverage };
    }
    const total = this.reference.totalRise;
    const clipMs = this.reference.durationMs;
    const rises = this.samples.map((s) => s.rise).sort((a, b) => a - b);
    const travel = rises[Math.floor(rises.length * 0.95)];
    if (travel < this.config.minTravel * total) return { score: null, reason: 'no-movement', coverage };

    // What is compared: the rise at each moment. After the clip the learner is only finishing, so
    // hands that come down again are not held against them, and time after the last tracked frame
    // counts as the hands staying where they were.
    const scored: Array<{ t: number; rise: number }> = [];
    let top = -Infinity;
    for (const s of this.samples) {
      top = Math.max(top, s.rise);
      scored.push({ t: s.t, rise: s.t > clipMs ? top : s.rise });
    }
    const last = scored[scored.length - 1];
    for (let t = last.t + this.reference.stepMs; t <= endMs; t += this.reference.stepMs) scored.push({ t, rise: last.rise });

    // Compare how the rise unfolds with how the artisan's does. Allowed without loss: a hand size
    // and reach within +-25% of the reference's, a later start, a slower pace down to the slowest
    // that still fits the take, and reacting up to 0.3 s late. Not allowed: a faster pace.
    let error = Infinity;
    let fit = { startMs: 0, stretch: 1 };
    for (const stretch of STRETCHES) {
      for (let startMs = 0; startMs + stretch * clipMs <= endMs + END_SLACK_MS; startMs += START_STEP_MS) {
        for (const scale of SCALES) {
          let sum = 0;
          for (const s of scored) {
            const progress = s.rise / (scale * total);
            let best = Infinity;
            for (const lag of LAGS_MS) {
              best = Math.min(best, Math.abs(progress - this.refRise((s.t - startMs - lag) / stretch) / total));
            }
            sum += best;
          }
          // The last two terms only decide between fits that are equally good.
          const e = sum / scored.length + 0.05 * Math.abs(Math.log(scale)) + 1e-6 * startMs + 1e-3 * (stretch - 1);
          if (e < error) {
            error = e;
            fit = { startMs, stretch };
          }
        }
      }
    }
    const { errorFree, errorZero, gapTol, gapWeight } = this.config;
    const progressScore = clamp01(1 - (error - errorFree) / (errorZero - errorFree));

    let gapError = 0;
    for (const s of this.samples) {
      const moment = (s.t - fit.startMs) / fit.stretch;
      gapError += Math.max(0, Math.abs(s.gapRatio - this.refAt(this.reference.gapRatio, moment)) - gapTol / 2);
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
    // Not started: nothing to judge yet. Watching first is allowed; the take outlasts the clip.
    if (progress < c.startProgress) return 'follow';

    // Too fast: ahead of the artisan on the screen, or rising faster than the artisan does.
    const lead = progress - this.refRise(tMs) / total;
    const past = this.sampleNear(tMs - SPEED_WINDOW_MS);
    const pace = past ? ((now.rise - past.rise) / (now.t - past.t)) / (total / this.reference.durationMs) : 1;
    if (lead > c.fastLead || pace > c.fastRatio) return 'too-fast';

    // Being behind is allowed, so the hands are compared with the artisan's at the same height of
    // the rise, not at the same moment of the clip.
    const moment = this.momentOf(now.rise);
    const gapError = now.gapRatio - this.refAt(this.reference.gapRatio, moment);
    if (gapError > c.gapTol) return 'hands-apart';
    if (gapError < -c.gapTol) return 'hands-close';
    if (Math.abs(now.tiltChange - this.refAt(this.reference.tiltChange, moment)) > c.tiltTol) return 'hands-uneven';
    if (this.shake(tMs) > c.shakeTol) return 'shaky';
    return 'steady';
  }

  /** The moment of the clip at which the artisan's hands had risen this far. */
  private momentOf(rise: number): number {
    let low = 0;
    let high = this.climb.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.climb[mid] < rise) low = mid + 1;
      else high = mid;
    }
    return low * this.reference.stepMs;
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
