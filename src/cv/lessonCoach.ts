import { Clay, shapeScore, type ClayShape } from './clay';
import { CoachEmitter } from './emitter';
import { HandTracker } from './handTracker';
import { countdownFeedback, feedback, resultFeedback } from './messages';
import {
  DEFAULT_CONFIG,
  START_FRAMES,
  TakeScorer,
  buildReference,
  isSteady,
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
/** The start pose is measured over the last moments before the clip starts. */
const READY_WINDOW_MS = 500;
/**
 * After the countdown the clip waits until both hands are at rest, because the hand that pressed
 * play has to come back first: at rest means in view just now, measured over most of the window,
 * and neither hand moved by more than a quarter of a hand size. It waits this long at most.
 */
const SETTLE_WAIT_MS = 4000;
const REST_TOLERANCE = 0.25;
const REST_SPAN_MS = 350;
const IN_VIEW_MS = 150;
/** The idle hint changes, and a lump the hands left behind goes, only after this long. */
const HINT_HOLD_MS = 400;
/** Before a take the lump follows the hands; it is placed from this much recent tracking. */
const PLACE_WINDOW_MS = 250;
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
  private readonly clay = new Clay();
  private modelPot: ClayShape | null = null;
  private recent: Array<{ at: number; measure: HandsMeasure }> = [];

  private readonly crop = document.createElement('canvas');
  private cropContext: CanvasRenderingContext2D | null = null;
  private ready: Array<{ at: number; measure: HandsMeasure }> = [];
  private bothHands = false;
  /** The countdown is over and the clip waits for the hands to come to rest. */
  private settling = false;
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
      const [{ reference, modelPot }, tracker] = await Promise.all([
        this.loadReference(),
        HandTracker.create({ wasmBase: this.options.wasmBase, modelUrl: this.options.modelUrl }),
        this.prepareLesson(),
      ]);
      this.reference = reference;
      this.modelPot = modelPot;
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
    this.timers.push(
      window.setTimeout(() => {
        this.settling = true;
        this.beginWhenAtRest(performance.now());
      }, COUNTDOWN_S * 1000),
    );
    this.timers.push(window.setTimeout(() => this.beginTake(), COUNTDOWN_S * 1000 + SETTLE_WAIT_MS));
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

  private async loadReference(): Promise<{ reference: ReferenceMotion; modelPot: ClayShape }> {
    const response = await fetch(this.options.referenceUrl);
    if (!response.ok) throw new Error(`reference motion: HTTP ${response.status}`);
    const file = (await response.json()) as ReferenceFile;
    return { reference: buildReference(file), modelPot: throwModelPot(file) };
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
      this.fail('camera-blocked');
    });
    video.srcObject = stream;
    await video.play();
  }

  // -------------------------------------------------------------------------------------------------
  // One take

  /**
   * What the hands held over the last moments, if they are in view right now; with `atRest`, only
   * if they have also stopped moving. Empty otherwise.
   */
  private startPose(now: number, atRest: boolean): HandsMeasure[] {
    const window = this.ready.filter((r) => r.at >= now - READY_WINDOW_MS);
    const newest = window[window.length - 1];
    if (!newest || now - newest.at > IN_VIEW_MS) return [];
    const pose = window.map((r) => r.measure);
    if (!atRest) return pose;
    return newest.at - window[0].at >= REST_SPAN_MS && isSteady(pose, REST_TOLERANCE) ? pose : [];
  }

  /** After the countdown, once per camera frame: start as soon as the hands are at rest, and say what is missing. */
  private beginWhenAtRest(now: number): void {
    if (this.startPose(now, true).length) {
      this.beginTake();
      return;
    }
    const code: FeedbackCode = this.bothHands ? 'hold-still' : 'show-hands';
    if (this.current.code !== code) this.setFeedback(feedback(code));
  }

  private beginTake(): void {
    if (!this.reference) return;
    this.settling = false;
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    const startPose = this.startPose(performance.now(), false);
    // No hands in view: the clip does not start. Hands that only come into view while it runs
    // would have their way into position scored as lifting.
    if (startPose.length === 0) {
      this.stop();
      return;
    }
    this.scorer = new TakeScorer(this.reference, DEFAULT_CONFIG);
    this.scorer.begin(startPose);
    // A fresh lump for this take, gripped by the start pose.
    this.clay.clear();
    this.clay.fit(startPose);
    this.setState('running');
    this.setFeedback(feedback('follow'));

    this.lessonVideo.currentTime = 0;
    const playing = [this.lessonVideo.play()];
    if (this.options.cameraFileUrl) {
      this.cameraVideo.currentTime = 0;
      playing.push(this.cameraVideo.play());
    }
    Promise.all(playing).catch((error) => {
      // Stopped before playback had settled: the take is already cancelled.
      if (this.state !== 'running') return;
      console.error('Coach: playback failed', error);
      this.stop();
    });
    this.runLessonClock();
  }

  private finishTake(): void {
    if (this.state !== 'running' || !this.scorer) return;
    const motion = this.scorer.finish();
    const pot = this.clay.shape();
    const shape = motion.score !== null && this.modelPot && pot.radii.length ? shapeScore(pot, this.modelPot) : null;
    const result = { ...motion, shapeScore: shape };
    this.scorer = null;
    this.stopLessonClock();
    if (this.options.cameraFileUrl) this.cameraVideo.pause();
    this.setTime(this.durationMs());
    this.emitter.emit('result', result);
    this.setState('finished');
    this.setFeedback(
      result.score === null
        ? feedback(result.reason as FeedbackCode)
        : resultFeedback(result.score, result.shapeScore, DEFAULT_CONFIG.goodScore),
    );
  }

  /** Cancels a countdown or a running take and rewinds the clip. */
  private clearTake(): void {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
    this.settling = false;
    this.scorer = null;
    this.stopLessonClock();
    if (this.lessonVideo) {
      this.lessonVideo.pause();
      if (this.lessonVideo.readyState > 0) this.lessonVideo.currentTime = 0;
    }
    if (this.options.cameraFileUrl && this.cameraVideo?.readyState > 0) {
      this.cameraVideo.pause();
      // The tracker follows each hand from frame to frame, so after the jump back it has to look afresh.
      this.cameraVideo.addEventListener('seeked', () => this.tracker?.reset(), { once: true });
      this.cameraVideo.currentTime = 0;
    }
    // The pot of the last take leaves the wheel. Hands that are in view right now keep their lump,
    // so pressing play does not make it blink.
    const now = performance.now();
    this.recent = this.recent.filter((r) => r.at >= now - PLACE_WINDOW_MS);
    this.clay.clear();
    this.clay.fit(this.recent.map((r) => r.measure));
    this.emitter.emit('clay', this.clay.placed ? this.clay.shape() : null);
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
    // Where the hands are and since when, kept in every state: a fresh lump can then follow a
    // finished pot at once, without an empty wheel in between.
    if (measure) {
      this.handsMissingSince = 0;
      this.handsSeenSince ||= now;
      this.recent.push({ at: now, measure });
      this.recent = this.recent.filter((r) => r.at >= now - PLACE_WINDOW_MS);
    } else {
      this.handsSeenSince = 0;
      this.handsMissingSince ||= now;
    }
    if (this.state === 'running' && this.scorer) {
      const code = this.scorer.push(this.lessonVideo.currentTime * 1000, measure);
      if (code !== this.current.code) this.setFeedback(feedback(code));
      this.clay.press(measure, now);
    } else if (this.state === 'countdown') {
      if (measure) this.ready.push({ at: now, measure });
      this.placeClay(now, measure);
      if (this.settling) this.beginWhenAtRest(now);
    } else if (this.state === 'ready') {
      this.updateHint(now);
      this.placeClay(now, measure);
    }
    this.emitter.emit('clay', this.clay.placed ? this.clay.shape() : null);
  }

  /**
   * Outside a take the lump sits wherever the hands hold it, so the learner sees it come to their
   * grip, and it leaves the wheel once the hands have been gone for a moment.
   */
  private placeClay(now: number, measure: HandsMeasure | null): void {
    if (measure) this.clay.fit(this.recent.map((r) => r.measure));
    else if (now - this.handsMissingSince >= HINT_HOLD_MS) this.clay.clear();
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

  private updateHint(now: number): void {
    if (this.bothHands) {
      if (now - this.handsSeenSince >= HINT_HOLD_MS && this.current.code !== 'press-play') {
        this.setFeedback(feedback('press-play'));
      }
    } else if (now - this.handsMissingSince >= HINT_HOLD_MS && this.current.code !== 'show-hands') {
      this.setFeedback(feedback('show-hands'));
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
    // No camera, so nothing is left on the picture: no skeleton and no clay.
    this.clay.clear();
    this.emitter.emit('hands', []);
    this.emitter.emit('clay', null);
    this.setState('error');
    this.setFeedback(feedback(code));
  }

  private release(): void {
    cancelAnimationFrame(this.cameraLoop);
    this.cameraVideo?.cancelVideoFrameCallback(this.cameraLoop);
    this.lessonVideo?.removeEventListener('ended', this.onLessonEnded);
    this.lessonVideo?.removeEventListener('pause', this.onLessonPaused);
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      // A <video> that still holds a stream keeps the page it was on in memory. Only our own stream
      // is taken off: in development React mounts the screen twice, and the second coach may already
      // have put its camera on the same element.
      if (this.cameraVideo.srcObject === this.stream) this.cameraVideo.srcObject = null;
      this.stream = null;
    }
    this.tracker?.close();
    this.tracker = null;
  }
}

/** The pot the reference motion makes on the same virtual clay: what a finished pot is compared with. */
function throwModelPot(file: ReferenceFile): ClayShape {
  const measures = file.frames.map((frame) => measureHands(frame as unknown as HandsFrame, file.view.aspect));
  const clay = new Clay();
  clay.fit(measures.slice(0, START_FRAMES).filter((m): m is HandsMeasure => m !== null));
  measures.forEach((measure, i) => clay.press(measure, file.frames[i].t));
  const shape = clay.shape();
  return { ...shape, radii: [...shape.radii] };
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
