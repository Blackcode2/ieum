import { Clay } from './clay';
import { CoachEmitter } from './emitter';
import { countdownFeedback, feedback, resultFeedback } from './messages';
import type { HandsMeasure } from './motion';
import type {
  CoachEventMap,
  CoachInit,
  CoachState,
  Feedback,
  LessonCoach,
  LessonTime,
  OverlayHand,
} from './types';

export type MockScenario = 'good' | 'bad';

const DURATION_MS = 5633;
const COUNTDOWN_S = 3;

// A loosely curled right hand in a 0..1 box; mirrored for the other hand. Only for the mock overlay.
const HAND_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.95], [0.3, 0.8], [0.2, 0.62], [0.16, 0.46], [0.14, 0.32],
  [0.36, 0.5], [0.34, 0.3], [0.33, 0.18], [0.32, 0.08],
  [0.5, 0.47], [0.5, 0.26], [0.5, 0.13], [0.5, 0.02],
  [0.63, 0.5], [0.65, 0.3], [0.66, 0.18], [0.67, 0.09],
  [0.76, 0.56], [0.8, 0.4], [0.83, 0.3], [0.85, 0.22],
];

function mockHand(cx: number, cy: number, size: number, flip: boolean): OverlayHand {
  return {
    points: HAND_SHAPE.map(([x, y]) => ({
      x: cx + ((flip ? 1 - x : x) - 0.5) * size,
      y: cy + (y - 0.5) * size * 1.1,
    })),
  };
}

/**
 * Stands in for the real coach without a camera or tracker, so the screen can be built and checked
 * in both pill states. Selected with ?mock=good or ?mock=bad.
 */
export class MockCoach implements LessonCoach {
  private readonly emitter = new CoachEmitter();
  private state: CoachState = 'loading';
  private current: Feedback = feedback('loading');
  private time: LessonTime = { currentMs: 0, durationMs: DURATION_MS };
  private timers: number[] = [];
  private raf = 0;
  private readonly clay = new Clay();

  constructor(private readonly scenario: MockScenario) {}

  async init(_init: CoachInit): Promise<void> {
    this.setState('ready');
    this.setFeedback(feedback('press-play'));
    this.emitter.emit('time', this.time);
    this.emitHands(0);
  }

  start(): void {
    this.clearTimers();
    // Back to the start pose and a fresh lump, also after a finished take.
    this.time = { currentMs: 0, durationMs: DURATION_MS };
    this.emitter.emit('time', this.time);
    this.emitHands(0);
    this.setState('countdown');
    for (let i = 0; i < COUNTDOWN_S; i++) {
      this.timers.push(window.setTimeout(() => this.setFeedback(countdownFeedback(COUNTDOWN_S - i)), i * 1000));
    }
    this.timers.push(window.setTimeout(() => this.run(), COUNTDOWN_S * 1000));
  }

  stop(): void {
    this.clearTimers();
    this.time = { currentMs: 0, durationMs: DURATION_MS };
    this.emitter.emit('time', this.time);
    this.setState('ready');
    this.setFeedback(feedback('press-play'));
    this.emitHands(0);
  }

  setMuted(_muted: boolean): void {}

  getState(): CoachState {
    return this.state;
  }

  getFeedback(): Feedback {
    return this.current;
  }

  getTime(): LessonTime {
    return this.time;
  }

  on<K extends keyof CoachEventMap>(type: K, handler: (payload: CoachEventMap[K]) => void): () => void {
    return this.emitter.on(type, handler);
  }

  dispose(): void {
    this.clearTimers();
    this.emitter.clear();
  }

  private run(): void {
    this.setState('running');
    this.setFeedback(feedback('follow'));
    const startedAt = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const currentMs = Math.min(elapsed, DURATION_MS);
      this.time = { currentMs, durationMs: DURATION_MS };
      this.emitter.emit('time', this.time);
      this.emitHands(currentMs / DURATION_MS);
      if (currentMs >= 1000) {
        const code = this.scenario === 'good' ? 'steady' : 'too-fast';
        if (this.current.code !== code) this.setFeedback(feedback(code));
      }
      if (elapsed >= DURATION_MS) {
        this.finish();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private finish(): void {
    const score = this.scenario === 'good' ? 92 : 48;
    const shapeScore = this.scenario === 'good' ? 88 : 61;
    this.emitter.emit('result', { score, shapeScore, reason: 'ok', coverage: 1 });
    this.setState('finished');
    this.setFeedback(resultFeedback(score, shapeScore, 75));
  }

  private emitHands(progress: number): void {
    const speed = this.scenario === 'good' ? 1 : 1.6;
    const y = 0.72 - 0.42 * Math.min(1, progress * speed);
    this.emitter.emit('hands', [mockHand(0.34, y, 0.2, false), mockHand(0.66, y, 0.2, true)]);

    // The same clay as the real coach, gripped by where the scripted hands are.
    const aspect = 1146 / 1027;
    const grip: HandsMeasure = {
      left: [0.34 * aspect, y],
      right: [0.66 * aspect, y],
      midY: y,
      gap: 0.32 * aspect,
      tilt: 0,
      size: 0.085,
    };
    if (progress === 0) this.clay.fit([grip]);
    else this.clay.press(grip, performance.now());
    this.emitter.emit('clay', this.clay.shape());
  }

  private setState(state: CoachState): void {
    this.state = state;
    this.emitter.emit('state', state);
  }

  private setFeedback(next: Feedback): void {
    this.current = next;
    this.emitter.emit('feedback', next);
  }

  private clearTimers(): void {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    cancelAnimationFrame(this.raf);
  }
}
