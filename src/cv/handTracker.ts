// Wrapper around MediaPipe Hand Landmarker for the live webcam.
// Pinned to @mediapipe/tasks-vision 0.10.35: 1.x reports usage metrics to Google and gives the same landmarks.
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Point } from './motion';

export type Delegate = 'GPU' | 'CPU';

export interface HandTrackerOptions {
  /** Folder serving node_modules/@mediapipe/tasks-vision/wasm (self-hosted, no trailing slash). */
  wasmBase: string;
  /** URL of the self-hosted hand_landmarker.task. */
  modelUrl: string;
}

export class HandTracker {
  delegate: Delegate = 'CPU';
  private landmarker: HandLandmarker | null = null;
  private lastTimestamp = -1;
  private rebuilding: Promise<void> | null = null;
  private closed = false;
  private model!: Uint8Array;
  private readonly options: HandTrackerOptions;

  private constructor(options: HandTrackerOptions) {
    this.options = options;
  }

  static async create(options: HandTrackerOptions): Promise<HandTracker> {
    const tracker = new HandTracker(options);
    const response = await fetch(options.modelUrl);
    if (!response.ok) throw new Error(`hand_landmarker.task: HTTP ${response.status}`);
    tracker.model = new Uint8Array(await response.arrayBuffer());
    await tracker.build('GPU');
    return tracker;
  }

  /**
   * Tracks the hands in one frame and returns 21 points per hand, normalised to the frame.
   * `source` must be the raw, un-mirrored picture. Returns null while the tracker is being rebuilt.
   */
  detect(source: TexImageSource, nowMs: number = performance.now()): Point[][] | null {
    if (!this.landmarker || this.rebuilding) return null;
    // Timestamps must increase strictly: one repeated or smaller value breaks the instance for good.
    const timestamp = Math.max(nowMs, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(source, timestamp);
    } catch (error) {
      console.error('HandTracker: detectForVideo failed, rebuilding', error);
      this.rebuild();
      return null;
    }
    return result.landmarks.map((hand) => hand.map((p): Point => [p.x, p.y]));
  }

  close(): void {
    this.closed = true;
    this.landmarker?.close();
    this.landmarker = null;
  }

  private async build(delegate: Delegate): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(this.options.wasmBase);
    const make = (d: Delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: this.model, delegate: d },
        canvas: this.ownCanvas(),
        runningMode: 'VIDEO',
        numHands: 2,
      });
    // One throw-away call compiles the WebGL programs; on a machine's first run this takes seconds,
    // so it happens here, behind the loading state, and not on the first camera frame.
    const warmUp = (landmarker: HandLandmarker) => void landmarker.detectForVideo(blankFrame(), 0);
    let landmarker: HandLandmarker;
    let used = delegate;
    try {
      landmarker = await make(delegate);
      warmUp(landmarker);
    } catch (error) {
      if (delegate !== 'GPU') throw error;
      console.warn('HandTracker: GPU delegate failed, using CPU', error);
      used = 'CPU';
      landmarker = await make('CPU');
      warmUp(landmarker);
    }
    if (this.closed) {
      landmarker.close();
      return;
    }
    this.landmarker = landmarker;
    this.delegate = used;
    this.lastTimestamp = 0; // the warm-up call used timestamp 0
  }

  /** Our own canvas, so a lost WebGL context (sleep / wake, GPU restart) is noticed and repaired. */
  private ownCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.addEventListener('webglcontextlost', () => this.rebuild(), { once: true });
    return canvas;
  }

  private rebuild(): void {
    if (this.rebuilding || this.closed) return;
    const old = this.landmarker;
    this.landmarker = null;
    try {
      old?.close();
    } catch {
      /* already broken */
    }
    this.rebuilding = this.build(this.delegate)
      .catch((error) => {
        console.error('HandTracker: rebuild failed', error);
        // Try again shortly: without a landmarker the lesson silently stops reacting.
        if (!this.closed) window.setTimeout(() => this.rebuild(), 1000);
      })
      .finally(() => {
        this.rebuilding = null;
      });
  }
}

function blankFrame(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  canvas.getContext('2d');
  return canvas;
}
