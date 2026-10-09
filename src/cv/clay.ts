// The virtual clay on the wheel. No DOM and no imports besides types, so tools/clay_check.ts can run
// it in Node on recorded hand tracks.
//
// A pot on a wheel is a body of revolution, so its shape is one curve: the outer radius at each
// height. The webcam sees the hands from the front, which gives the width of their grip and its
// height, and that is all the curve needs; depth, which the tracker cannot measure, is never used.
//
// The clay goes where the hands go. A grip that touches the wall sets the wall's radius where it
// holds, and a grip that rises carries the wall up with it; hands that hold still, let go or move
// down change nothing. The amount of clay is fixed, so the taller the pot is drawn, the thinner its
// wall becomes, and a wall that is too thin refuses to rise further. This is a hand-following model
// for practising the movement, not a simulation of real clay: pressure, water and the inside hand
// are not modelled. (Squeezing a lump and letting the displaced clay push the rim up, the obvious
// physical rule, was tried first: bare hands miming a lift do not squeeze, so the pot ignored the lift
// and grew when the hands stood still.)
import type { HandsMeasure } from './motion';

export interface ClayConfig {
  /** Half the height the grip covers, in hand sizes. */
  bandHalf: number;
  /** The wheel head sits this far below the hands' lower edge (hand sizes). */
  baseBelow: number;
  /** Starting wall thickness as a share of the starting radius. */
  wallShare: number;
  /** The pot refuses to rise once its wall is this share of the starting wall. */
  thinWall: number;
  /** The rim never comes closer than this to the top of the view (view heights). */
  topMargin: number;
  /** Seconds: how fast the wall yields to a grip inside it, and how fast it follows one that opens. */
  yieldSeconds: number;
  followSeconds: number;
  /** A wall follows an opening grip only this long after the grip last rose, and no faster than this (hand sizes per second). */
  followHold: number;
  followSpeed: number;
  /** Seconds of smoothing on the grip, on top of a median over three frames. */
  smoothSeconds: number;
  /** Tracking may drop out this long before the grip counts as released. */
  graceSeconds: number;
  /** Lengths below are in hand sizes, so they hold for a learner who sits nearer or further away. */
  slice: number;
  /** Soft ends of the grip. */
  shoulder: number;
  /** A grip this close outside the wall starts to touch; one further out than `release` lets go. */
  touch: number;
  release: number;
  /** The grip must overlap the pot by this much height to touch at all. */
  overlap: number;
  /** Dead band of the lift, so that tracking jitter cannot pump the pot up. */
  deadBand: number;
  /** Smoothing along the height under the grip, per camera frame (0..0.25). */
  blend: number;
}

export const CLAY_CONFIG: ClayConfig = {
  bandHalf: 1.25,
  baseBelow: 0.1,
  wallShare: 0.4,
  thinWall: 0.25,
  topMargin: 0.04,
  yieldSeconds: 0.04,
  followSeconds: 0.15,
  followHold: 0.25,
  followSpeed: 0.42,
  smoothSeconds: 0.05,
  graceSeconds: 0.3,
  slice: 0.053,
  shoulder: 0.32,
  touch: 0.32,
  release: 0.53,
  overlap: 0.21,
  deadBand: 0.13,
  blend: 0.15,
};

const SHAPE_SAMPLES = 64;
const CAMERA_FPS = 30;
/** Hands held one above the other have no gap to measure: the lump is never thinner than this (hand sizes). */
const MIN_RADIUS = 0.75;

/**
 * What a renderer or a comparison needs. Lengths are in the tracked view's height units and positions
 * in its un-mirrored coordinates (x right, y down), the same as the hand measurements.
 */
export interface ClayShape {
  /** x of the wheel's axis and y of the wheel head. */
  axisX: number;
  baseY: number;
  /** Radius and height of the lump the take started with. */
  startRadius: number;
  startHeight: number;
  height: number;
  /** Outer radius at evenly spaced heights, from the wheel head up to the rim. */
  radii: ReadonlyArray<number>;
  /** Wall thickness that holds the clay's volume in this shape. */
  wall: number;
  /** True once the wall is too thin to rise further. */
  tooThin: boolean;
  /** True while the grip is on the clay. */
  touching: boolean;
}

/** The grip as the clay sees it: at distance `d` from the axis, from height z0 up to z1 above the wheel head. */
interface Band {
  d: number;
  z0: number;
  z1: number;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const smoothStep = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Share of a gap closed in `seconds` by an exponential approach with the given time constant. */
const approach = (seconds: number, weight: number, timeConstant: number): number =>
  1 - Math.exp((-seconds * weight) / timeConstant);

export class Clay {
  private readonly config: ClayConfig;
  private axisX = 0;
  private baseY = 0;
  private unit = 0;
  private startRadius = 0;
  private startHeight = 0;
  private startWall = 0;
  private volume = 0;
  /** Thin slices of revolution, bottom first: each has its own height and outer radius. */
  private heights: number[] = [];
  private radii: number[] = [];

  private recent: Band[] = [];
  private band: Band | null = null;
  private touching = false;
  private tooThin = false;
  /** Height the grip's centre has to pass before the next bit of lift. */
  private anchor = 0;
  private sinceRise = Infinity;
  private missing = 0;
  private lastPressMs: number | null = null;

  constructor(config: ClayConfig = CLAY_CONFIG) {
    this.config = config;
  }

  get placed(): boolean {
    return this.radii.length > 0;
  }

  /** Puts a fresh lump on the wheel: as wide as the grip in `ready`, as tall as the hands, between them. */
  fit(ready: ReadonlyArray<HandsMeasure>): void {
    if (ready.length === 0) return;
    const c = this.config;
    const size = median(ready.map((m) => m.size));
    if (!(size > 0)) return;
    const radius = Math.max(median(ready.map((m) => Math.abs(m.right[0] - m.left[0]) / 2)), MIN_RADIUS * size);

    this.unit = size;
    this.axisX = median(ready.map((m) => (m.left[0] + m.right[0]) / 2));
    this.baseY = median(ready.map((m) => Math.max(m.left[1], m.right[1]))) + (c.bandHalf + c.baseBelow) * size;
    this.startRadius = radius;
    this.startHeight = Math.max(4 * c.slice * size, this.baseY - (median(ready.map((m) => m.midY)) - c.bandHalf * size));
    this.startWall = c.wallShare * radius;
    this.volume = Math.PI * (2 * radius * this.startWall - this.startWall ** 2) * this.startHeight;

    const count = Math.max(8, Math.round(this.startHeight / (c.slice * size)));
    this.heights = new Array<number>(count).fill(this.startHeight / count);
    this.radii = new Array<number>(count).fill(radius);
    this.recent = [];
    this.band = null;
    this.touching = false;
    this.tooThin = false;
    this.sinceRise = Infinity;
    this.missing = 0;
    this.lastPressMs = null;
  }

  /** Takes the clay off the wheel. */
  clear(): void {
    this.heights = [];
    this.radii = [];
    this.recent = [];
    this.band = null;
    this.touching = false;
    this.tooThin = false;
    this.lastPressMs = null;
  }

  /** One camera frame at time nowMs. `measure` is null while the two hands are not both tracked. */
  press(measure: HandsMeasure | null, nowMs: number): void {
    const elapsed = this.lastPressMs === null ? 1 / CAMERA_FPS : (nowMs - this.lastPressMs) / 1000;
    this.lastPressMs = nowMs;
    if (!this.placed) return;
    const c = this.config;
    // A time that is not a number would turn every radius into NaN.
    const seconds = Number.isFinite(elapsed) ? Math.min(0.1, Math.max(1 / 120, elapsed)) : 1 / CAMERA_FPS;

    if (!measure) {
      // A short dropout changes nothing; a long one means the hands have left the clay.
      this.missing += seconds;
      if (this.missing > c.graceSeconds) {
        this.touching = false;
        this.band = null;
        this.recent = [];
      }
      return;
    }
    this.missing = 0;

    // The grip: half the gap between the hands, which does not depend on where the axis was placed,
    // over the heights the hands cover. Median of three frames, then a short smoothing.
    const half = c.bandHalf * this.unit;
    const raw: Band = {
      d: Math.abs(measure.right[0] - measure.left[0]) / 2,
      z0: this.baseY - measure.midY - half,
      z1: this.baseY - measure.midY + half,
    };
    this.recent = [...this.recent, raw].slice(-3);
    const steady: Band = {
      d: median(this.recent.map((b) => b.d)),
      z0: median(this.recent.map((b) => b.z0)),
      z1: median(this.recent.map((b) => b.z1)),
    };
    if (!this.band) this.band = steady;
    else {
      const a = 1 - Math.exp(-seconds / c.smoothSeconds);
      this.band.d += (steady.d - this.band.d) * a;
      this.band.z0 += (steady.z0 - this.band.z0) * a;
      this.band.z1 += (steady.z1 - this.band.z1) * a;
    }
    this.grip(this.band, seconds);
    this.settle(this.band, seconds);
  }

  shape(): ClayShape {
    const height = this.heights.reduce((sum, h) => sum + h, 0);
    // Resample the slices, which differ in height, onto an even grid.
    const radii: number[] = [];
    let slice = 0;
    let top = this.heights[0] ?? 0;
    for (let i = 0; this.placed && i < SHAPE_SAMPLES; i++) {
      const z = ((i + 0.5) / SHAPE_SAMPLES) * height;
      while (z > top && slice < this.heights.length - 1) top += this.heights[++slice];
      radii.push(this.radii[slice] ?? 0);
    }
    return {
      axisX: this.axisX,
      baseY: this.baseY,
      startRadius: this.startRadius,
      startHeight: this.startHeight,
      height,
      radii,
      wall: this.placed ? this.wallThickness() : 0,
      tooThin: this.tooThin,
      touching: this.touching,
    };
  }

  // -------------------------------------------------------------------------------------------------

  /** 1 inside the grip, smooth ramps centred on its two ends, 0 beyond. */
  private weight(z: number, band: Band, shoulder: number): number {
    return smoothStep((z - band.z0 + shoulder) / (2 * shoulder)) * smoothStep((band.z1 + shoulder - z) / (2 * shoulder));
  }

  private middles(): { z: number[]; height: number } {
    const z = new Array<number>(this.heights.length);
    let sum = 0;
    for (let i = 0; i < this.heights.length; i++) {
      z[i] = sum + this.heights[i] / 2;
      sum += this.heights[i];
    }
    return { z, height: sum };
  }

  /** The uniform wall thickness that holds the clay's volume in its current outer shape. */
  private wallThickness(): number {
    const volumeAt = (wall: number): number => {
      let v = 0;
      for (let i = 0; i < this.heights.length; i++) {
        const inner = Math.max(0, this.radii[i] - wall);
        v += (this.radii[i] ** 2 - inner ** 2) * this.heights[i];
      }
      return Math.PI * v;
    };
    let low = 0;
    let high = Math.max(...this.radii);
    if (volumeAt(high) <= this.volume) return high; // more clay than the shape holds: solid
    for (let k = 0; k < 30; k++) {
      const mid = (low + high) / 2;
      if (volumeAt(mid) < this.volume) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  /** A grip on the wall sets the wall's radius where it holds, and carries the wall up when it rises. */
  private grip(band: Band, seconds: number): void {
    const c = this.config;
    const u = this.unit;
    this.sinceRise += seconds;
    const { z, height } = this.middles();
    const count = this.radii.length;
    const weights = new Array<number>(count);
    let overlap = 0;
    let widest = 0;
    for (let i = 0; i < count; i++) {
      weights[i] = this.weight(z[i], band, c.shoulder * u);
      overlap += weights[i] * this.heights[i];
      if (weights[i] > 0.5 && this.radii[i] > widest) widest = this.radii[i];
    }
    const centre = (band.z0 + band.z1) / 2;
    const deadBand = c.deadBand * u;
    if (overlap < c.overlap * u || widest === 0) this.touching = false;
    else if (!this.touching) {
      if (band.d <= widest + c.touch * u) {
        this.touching = true;
        this.anchor = centre + deadBand / 2;
      }
    } else if (band.d > widest + c.release * u) this.touching = false;

    // Clay outside the grip yields at once. A wall inside it follows slowly, and only on the way up,
    // so hands that open or let go do not drag the pot out of shape.
    const follows = this.touching && this.sinceRise <= c.followHold;
    const floor = 0.2 * this.startRadius;
    const d = Math.max(band.d, floor);
    for (let i = 0; i < count; i++) {
      if (weights[i] <= 0) continue;
      const gap = d - this.radii[i];
      if (gap < 0) this.radii[i] += gap * approach(seconds, weights[i], c.yieldSeconds);
      else if (follows && gap < c.release * u) {
        this.radii[i] += Math.min(gap * approach(seconds, weights[i], c.followSeconds), c.followSpeed * u * seconds);
      }
    }

    if (!this.touching) return;
    if (centre <= this.anchor) {
      if (centre < this.anchor - deadBand) this.anchor = centre + deadBand;
      return;
    }
    // The grip has risen: the slices it holds stretch by that much and everything above rides up.
    const rise = centre - this.anchor;
    this.anchor = centre;
    this.sinceRise = 0;
    const ceiling = this.baseY - c.topMargin;
    const lift = Math.min(rise, Math.max(0, ceiling - height));
    if (!(lift > 0) || !(overlap > 0)) return;
    const before = this.heights.slice();
    for (let i = 0; i < count; i++) if (weights[i] > 0) this.heights[i] *= 1 + (lift * weights[i]) / overlap;
    this.tooThin = this.wallThickness() < c.thinWall * this.startWall;
    if (this.tooThin) this.heights = before;
  }

  /** After each frame: a light smoothing along the height under the grip, and slices kept near their size. */
  private settle(band: Band, seconds: number): void {
    const c = this.config;
    const strength = Math.min(0.25, c.blend * seconds * CAMERA_FPS);
    const count = this.radii.length;
    if (count > 2) {
      const { z } = this.middles();
      const out = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        const k = this.weight(z[i], band, 2 * c.shoulder * this.unit);
        const below = this.radii[Math.max(0, i - 1)];
        const above = this.radii[Math.min(count - 1, i + 1)];
        out[i] = this.radii[i] + strength * k * (below - 2 * this.radii[i] + above);
      }
      this.radii = out;
    }
    const size = c.slice * this.unit;
    const heights: number[] = [];
    const radii: number[] = [];
    for (let i = 0; i < count; i++) {
      const parts = this.heights[i] > 1.5 * size ? Math.ceil(this.heights[i] / size) : 1;
      for (let j = 0; j < parts; j++) {
        heights.push(this.heights[i] / parts);
        radii.push(this.radii[i]);
      }
    }
    this.heights = heights;
    this.radii = radii;
  }
}

// ---------------------------------------------------------------------------------------------------
// Judging a finished pot

/** How uneven the wall may be, as a mean deviation from the starting radius, before evenness counts for nothing. */
const UNEVEN_ZERO = 0.25;

/**
 * 모양 일치도, 0-100: did the wall come up as far as the model pot's, and is it even?
 *
 * Height is judged as growth from the pot's own starting lump, compared with how far the reference
 * motion raises its lump, and evenness as how close the wall stays to the radius it started with. Both
 * are in the pot's own proportions, so a learner with bigger hands or one who sits further from the
 * camera is not penalised.
 */
export function shapeScore(pot: ClayShape, model: ClayShape): number {
  if (!pot.radii.length || !(pot.startHeight > 0) || !(model.startHeight > 0)) return 0;
  const grown = pot.height / pot.startHeight - 1;
  const wanted = model.height / model.startHeight - 1;
  const reached = wanted > 0 ? Math.min(1, Math.max(0, grown / wanted)) : 1;
  let uneven = 0;
  for (const radius of pot.radii) uneven += Math.abs(radius / pot.startRadius - 1);
  const even = Math.min(1, Math.max(0, 1 - uneven / pot.radii.length / UNEVEN_ZERO));
  return Math.round(100 * reached * (0.5 + 0.5 * even));
}
