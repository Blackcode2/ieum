import type { ClayShape } from './clay';

// Contract between the lesson screen and the video-processing side.
// The screen owns the two <video> elements and the overlay canvas; the coach owns the camera,
// the hand tracker, lesson playback and the feedback shown in the pill.

export type CoachState = 'loading' | 'ready' | 'countdown' | 'running' | 'finished' | 'error';

/** Drives the pill colour: green, red, or the dark neutral used for guidance. */
export type FeedbackTone = 'good' | 'bad' | 'neutral';

export type FeedbackCode =
  | 'loading'
  | 'load-failed'
  | 'camera-blocked'
  | 'show-hands'
  | 'press-play'
  | 'countdown'
  | 'hold-still'
  | 'follow'
  | 'steady'
  | 'too-fast'
  | 'too-slow'
  | 'hands-uneven'
  | 'hands-apart'
  | 'hands-close'
  | 'shaky'
  | 'hands-lost'
  | 'result-good'
  | 'result-bad'
  | 'no-movement'
  | 'not-tracked';

export interface Feedback {
  tone: FeedbackTone;
  code: FeedbackCode;
  message: string;
}

export interface OverlayPoint {
  x: number;
  y: number;
}

/**
 * One tracked hand, for drawing. Points are in MediaPipe order (0 wrist .. 20 pinky tip), normalised
 * to the visible camera area (the centre crop the panel shows with object-fit: cover) and NOT mirrored:
 * x grows towards the right of the raw camera image. A mirrored preview draws at 1 - x.
 */
export interface OverlayHand {
  points: ReadonlyArray<OverlayPoint>;
}

export interface LessonTime {
  currentMs: number;
  durationMs: number;
}

export type ResultReason = 'ok' | 'no-movement' | 'not-tracked';

export interface MotionResult {
  /** 동작 일치도, 0-100. null when the take could not be scored. */
  score: number | null;
  reason: ResultReason;
  /** Share of the take in which both hands were tracked, 0-1. */
  coverage: number;
}

export interface SessionResult extends MotionResult {
  /** 모양 일치도, 0-100: how close the finished pot is to the one the reference motion makes. */
  shapeScore: number | null;
}

export interface CoachEventMap {
  state: CoachState;
  feedback: Feedback;
  hands: ReadonlyArray<OverlayHand>;
  /** The virtual clay after each camera frame, or null while there is none on the wheel. */
  clay: ClayShape | null;
  time: LessonTime;
  result: SessionResult;
}

export interface CoachInit {
  /** The screen's <video> for the webcam preview. The coach attaches the camera stream to it. */
  cameraVideo: HTMLVideoElement;
  /** The screen's <video> for the artisan clip. The coach loads and plays it. */
  lessonVideo: HTMLVideoElement;
  /**
   * width / height of the camera panel. Only the centre crop with this aspect is tracked,
   * which is exactly what the panel shows with object-fit: cover.
   */
  viewAspect: number;
}

export interface LessonCoach {
  /** Loads the tracker, the reference motion and the camera. Resolves in state 'ready' or 'error'. */
  init(init: CoachInit): Promise<void>;
  /** Starts a take: countdown, then one play-through of the lesson clip with live feedback. */
  start(): void;
  /** Aborts the current take and returns to 'ready'. */
  stop(): void;
  setMuted(muted: boolean): void;
  getState(): CoachState;
  getFeedback(): Feedback;
  getTime(): LessonTime;
  /** Subscribes to an event; returns the function that unsubscribes. */
  on<K extends keyof CoachEventMap>(type: K, handler: (payload: CoachEventMap[K]) => void): () => void;
  dispose(): void;
}

/** Bone list for drawing a hand skeleton, as index pairs into OverlayHand.points. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
