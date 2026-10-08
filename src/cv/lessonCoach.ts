import { CoachEmitter } from './emitter';
import { HandTracker } from './handTracker';
import { countdownFeedback, feedback, resultFeedback } from './messages';
import {
  DEFAULT_CONFIG,
  TakeScorer,
  buildReference,
  measureHands,
  type HandsFrame,
  type HandsMeasure,
  type Point,
  type ReferenceFile,
  type ReferenceMotion,
} from './motion';
import type {
  CoachEventMap,
  CoachInit,
  CoachState,
  Feedback,
  FeedbackCode,
  LessonCoach,
  LessonTime,
} from './types';

export interface RealCoachOptions {
  lessonUrl: string;
  referenceUrl: string;
  wasmBase: string;
  modelUrl: string;
  /** A recording to follow instead of the webcam: the fallback if the camera fails, and the test input. */
  cameraFileUrl?: string | null;
}

const COUNTDOWN_S = 3;
/** The start pose is measured over the last moments of the countdown. */
const READY_WINDOW_MS = 500;
/** The idle hint changes only after the hands have been seen or missing this long. */
const HINT_HOLD_MS = 400;
/** A paused recording produces no new frames, so it is polled at about camera rate instead. */
const FILE_FRAME_MS = 30;
const TIME_EVENT_MS = 100;

/** Camera, hand tracker, lesson playback and feedback for the lesson screen. */
export class RealCoach implements LessonCoach {
  private readonly emitter = new CoachEmitter();
  private readonly options: RealCoachOptions;
  private state: CoachState = 'loading';
  private current: Feedback = feedback('loading');
  private time: LessonTime = { currentMs: 0, durationMs: 0 };

  private cameraVideo!: HTMLVideoElement;
  private lessonVideo!: HTMLVideoElement;
  private viewAspect = 1;
  private stream: MediaStream | null = null;
  private tracker: HandTracker | null = null;
  private reference: ReferenceMotion | null = null;
  private scorer: TakeScorer | null = null;

  private readonly crop = document.createElement('canvas');
  private cropContext: CanvasRenderingContext2D | null = null;
  private ready: Array<{ at: number; measure: HandsMeasure }> = [];
  private bothHands = false;
  private handsSeenSince = 0;
  private handsMissingSince = 0;
  private lastTimeEvent = 0;

  private disposed = false;
  private timers: number[] = [];
  private cameraLoop = 0;
  private lessonLoop = 0;
  private readonly onLessonEnded = () => this.finishTake();
  /** Playback stopped from outside (media key, headset, OS): the take cannot finish, so cancel it. */
  private readonly onLessonPaused = () => {
    if (this.state === 'running' && !this.lessonVideo.ended) this.stop();
  };

  constructor(options: RealCoachOptions) {
    this.options = options;
  }

  async init(init: CoachInit): Promise<void> {
    this.cameraVideo = init.cameraVideo;
    this.lessonVideo = init.lessonVideo;
    this.viewAspect = init.viewAspect;
    this.emitter.emit('state', this.state);
    this.emitter.emit('feedback', this.current);

    try {
      const [reference, tracker] = await Promise.all([
        this.loadReference(),
        HandTracker.create({ wasmBase: this.options.wasmBase, modelUrl: this.options.modelUrl }),
        this.prepareLesson(),
      ]);
      this.reference = reference;
      this.tracker = tracker;
    } catch (error) {
      if (this.disposed) {
        this.release();
        return;
      }
      console.error('Coach: loading failed', error);
      this.fail('load-failed');
      return;
    }
    if (this.disposed) {
      this.release();
      return;
    }
    try {
      await this.openCamera();
    } catch (error) {
      if (this.disposed) {
        this.release();
        return;
      }
      console.error('Coach: camera unavailable', error);
      this.fail('camera-blocked');
      return;
    }
    if (this.disposed) {
      this.release();
      return;
    }
    this.setTime(0);
    this.setState('ready');
    this.setFeedback(feedback('show-hands'));
    this.runCameraLoop();
  }

  start(): void {
    if (this.state === 'loading' || this.state === 'error') return;
    this.clearTake();
    this.ready = [];
    this.setState('countdown');
    for (let i = 0; i < COUNTDOWN_S; i++) {
      this.timers.push(window.setTimeout(() => this.setFeedback(countdownFeedback(COUNTDOWN_S - i)), i * 1000));
    }
    this.timers.push(window.setTimeout(() => this.beginTake(), COUNTDOWN_S * 1000));
  }

  stop(): void {
    if (this.state === 'loading' || this.state === 'error') return;
    this.clearTake();
    this.setState('ready');
    this.handsSeenSince = 0;
    this.handsMissingSince = 0;
    this.setFeedback(feedback(this.bothHands ? 'press-play' : 'show-hands'));
  }

  setMuted(muted: boolean): void {
    if (this.lessonVideo) this.lessonVideo.muted = muted;
  }

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
    this.disposed = true;
    this.clearTake();
    this.release();
    this.emitter.clear();
  }

  // -------------------------------------------------------------------------------------------------
  // Loading

  private async loadReference(): Promise<ReferenceMotion> {
    const response = await fetch(this.options.referenceUrl);
    if (!response.ok) throw new Error(`reference motion: HTTP ${response.status}`);
    return buildReference((await response.json()) as ReferenceFile);
  }

  private prepareLesson(): Promise<void> {
    const video = this.lessonVideo;
    video.addEventListener('ended', this.onLessonEnded);
    video.addEventListener('pause', this.onLessonPaused);
    return loadVideo(video, this.options.lessonUrl);
  }

  private async openCamera(): Promise<void> {
    const video = this.cameraVideo;
    video.muted = true;
    video.playsInline = true;
    if (this.options.cameraFileUrl) {
      await loadVideo(video, this.options.cameraFileUrl);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    if (this.disposed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    // Unplugged, or taken by another app: say so instead of leaving a black panel and a live play button.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.disposed) return;
      this.clearTake();
      this.emitter.emit('hands', []);
      this.fail('camera-blocked');
    });
    video.srcObject = stream;
    await video.play();
  }

  // -------------------------------------------------------------------------------------------------
  // One take

  private beginTake(): void {
    if (!this.reference) return;
    const since = performance.now() - READY_WINDOW_MS;
    this.scorer = new TakeScorer(this.reference, DEFAULT_CONFIG);
    this.scorer.begin(this.ready.filter((r) => r.at >= since).map((r) => r.measure));
    this.setState('running');
    this.setFeedback(feedback('follow'));

    this.lessonVideo.currentTime = 0;
    const playing = [this.lessonVideo.play()];
    if (this.options.cameraFileUrl) {
      this.cameraVideo.currentTime = 0;
      playing.push(this.cameraVideo.play());
    }
    Promise.all(playing).catch((error) => {
      console.error('Coach: playback failed', error);
      this.stop();
    });
    this.runLessonClock();
  }

  private finishTake(): void {
    if (this.state !== 'running' || !this.scorer) return;
    const result = this.scorer.finish();
    this.scorer = null;
    this.stopLessonClock();
    if (this.options.cameraFileUrl) this.cameraVideo.pause();
    this.setTime(this.durationMs());
    this.emitter.emit('result', result);
    this.setState('finished');
    this.setFeedback(
      result.score === null ? feedback(result.reason as FeedbackCode) : resultFeedback(result.score, DEFAULT_CONFIG.goodScore),
    );
  }

  /** Cancels a countdown or a running take and rewinds the clip. */
  private clearTake(): void {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    this.scorer = null;
    this.stopLessonClock();
    if (this.lessonVideo) {
      this.lessonVideo.pause();
      if (this.lessonVideo.readyState > 0) this.lessonVideo.currentTime = 0;
    }
    if (this.options.cameraFileUrl && this.cameraVideo?.readyState > 0) {
      this.cameraVideo.pause();
      this.cameraVideo.currentTime = 0;
    }
    this.setTime(0);
  }

  // -------------------------------------------------------------------------------------------------
  // Frames

  private runCameraLoop(): void {
    const video = this.cameraVideo;
    if (this.options.cameraFileUrl) {
      let last = 0;
      const tick = (now: number) => {
        if (this.disposed) return;
        this.cameraLoop = requestAnimationFrame(tick);
        if (now - last < FILE_FRAME_MS) return;
        last = now;
        this.processFrame(now);
      };
      this.cameraLoop = requestAnimationFrame(tick);
      return;
    }
    // One call per new camera frame; the next one is requested first so an error cannot stop the loop.
    const onFrame = (now: number) => {
      if (this.disposed) return;
      this.cameraLoop = video.requestVideoFrameCallback(onFrame);
      this.processFrame(now);
    };
    this.cameraLoop = video.requestVideoFrameCallback(onFrame);
  }

  private processFrame(now: number): void {
    const frame = this.trackFrame(now);
    if (!frame) return;
    const hands = [frame.left, frame.right].filter((points): points is Point[] => points !== null);
    this.emitter.emit('hands', hands.map((points) => ({ points: points.map(([x, y]) => ({ x, y })) })));

    const measure = measureHands(frame, this.crop.width / this.crop.height);
    this.bothHands = measure !== null;
    if (this.state === 'running' && this.scorer) {
      const code = this.scorer.push(this.lessonVideo.currentTime * 1000, measure);
      if (code !== this.current.code) this.setFeedback(feedback(code));
    } else if (this.state === 'countdown') {
      if (measure) this.ready.push({ at: now, measure });
    } else if (this.state === 'ready') {
      this.updateHint(now, measure !== null);
    }
  }

  /** Tracks the hands in the centre crop of the current camera frame; left / right by picture side. */
  private trackFrame(now: number): { left: Point[] | null; right: Point[] | null } | null {
    const video = this.cameraVideo;
    if (!this.tracker || video.readyState < 2 || video.videoWidth === 0) return null;
    // The same centre crop the panel shows with object-fit: cover, whatever the camera's shape.
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width / height > this.viewAspect) width = Math.round(height * this.viewAspect);
    else height = Math.round(width / this.viewAspect);
    if (this.crop.width !== width || this.crop.height !== height || !this.cropContext) {
      this.crop.width = width;
      this.crop.height = height;
      this.cropContext = this.crop.getContext('2d');
    }
    if (!this.cropContext) return null;
    const left = (video.videoWidth - width) / 2;
    const top = (video.videoHeight - height) / 2;
    this.cropContext.drawImage(video, left, top, width, height, 0, 0, width, height);

    const hands = this.tracker.detect(this.crop, now);
    if (!hands) return null;
    const meanX = (points: Point[]) => points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const sorted = [...hands].sort((a, b) => meanX(a) - meanX(b));
    const frame: HandsFrame & { left: Point[] | null; right: Point[] | null } = { left: null, right: null };
    if (sorted.length >= 2) {
      frame.left = sorted[0];
      frame.right = sorted[sorted.length - 1];
    } else if (sorted.length === 1) {
      frame[meanX(sorted[0]) < 0.5 ? 'left' : 'right'] = sorted[0];
    }
    return frame;
  }

  private updateHint(now: number, bothHands: boolean): void {
    if (bothHands) {
      this.handsMissingSince = 0;
      this.handsSeenSince ||= now;
      if (now - this.handsSeenSince >= HINT_HOLD_MS && this.current.code !== 'press-play') {
        this.setFeedback(feedback('press-play'));
      }
    } else {
      this.handsSeenSince = 0;
      this.handsMissingSince ||= now;
      if (now - this.handsMissingSince >= HINT_HOLD_MS && this.current.code !== 'show-hands') {
        this.setFeedback(feedback('show-hands'));
      }
    }
  }

  private runLessonClock(): void {
    const video = this.lessonVideo;
    const onFrame = (now: number) => {
      if (this.state !== 'running') return;
      this.lessonLoop = video.requestVideoFrameCallback(onFrame);
      if (now - this.lastTimeEvent < TIME_EVENT_MS) return;
      this.lastTimeEvent = now;
      this.setTime(video.currentTime * 1000);
    };
    this.lessonLoop = video.requestVideoFrameCallback(onFrame);
  }

  private stopLessonClock(): void {
    this.lessonVideo?.cancelVideoFrameCallback(this.lessonLoop);
  }

  // -------------------------------------------------------------------------------------------------

  private durationMs(): number {
    const seconds = this.lessonVideo?.duration;
    return Number.isFinite(seconds) ? seconds * 1000 : (this.reference?.durationMs ?? 0);
  }

  private setTime(currentMs: number): void {
    this.time = { currentMs, durationMs: this.durationMs() };
    this.emitter.emit('time', this.time);
  }

  private setState(state: CoachState): void {
    this.state = state;
    this.emitter.emit('state', state);
  }

  private setFeedback(next: Feedback): void {
    this.current = next;
    this.emitter.emit('feedback', next);
  }

  private fail(code: FeedbackCode): void {
    this.release();
    if (this.disposed) return;
    this.setState('error');
    this.setFeedback(feedback(code));
  }

  private release(): void {
    cancelAnimationFrame(this.cameraLoop);
    this.cameraVideo?.cancelVideoFrameCallback(this.cameraLoop);
    this.lessonVideo?.removeEventListener('ended', this.onLessonEnded);
    this.lessonVideo?.removeEventListener('pause', this.onLessonPaused);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.tracker?.close();
    this.tracker = null;
  }
}

/** Points a <video> at a file and resolves once its first frame can be shown. */
function loadVideo(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', failed);
      reject(new Error(`could not load ${url}`));
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('error', failed);
    video.preload = 'auto';
    video.playsInline = true;
    video.src = url;
    video.load();
  });
}
