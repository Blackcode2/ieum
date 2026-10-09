import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HAND_CONNECTIONS,
  createCoach,
  type ClayShape,
  type CoachState,
  type Feedback,
  type LessonCoach,
  type LessonTime,
  type OverlayHand,
  type SessionResult,
} from '../../cv';
import { EXPERIENCE } from '../../data/museum';
import { KioskStage } from '../../kiosk/KioskStage';
import { IdleReturn, pokeIdle } from '../../kiosk/idle';
import ui from '../../kiosk/ui.module.css';
import { publicUrl } from '../../publicUrl';
import { ROUTES, go } from '../../routes';
import styles from './LessonPage.module.css';
import { PhotoStep } from './PhotoStep';
import type { WheelScene } from './WheelScene';
import { cameraCrop, composeSouvenir } from './souvenir';

/** Header, both panels and the player controls, as in the Figma frames "Desktop - 2 / 3". */
const STAGE_HEIGHT = 1212;
const PANEL_WIDTH = 1146;
const PANEL_HEIGHT = 1027;
/** Backing-store pixels per design pixel, so the skeleton stays sharp when the frame is scaled. */
const OVERLAY_DENSITY = 2;
/** The wheel is drawn a little finer than the design grid; the hands layer only re-shows camera pixels. */
const WHEEL_DENSITY = 1.5;
/** How wide a finger is drawn in the hands mask, in hand sizes. */
const FINGER_WIDTH = 0.5;
/**
 * A stroke's round end reaches half a finger width past the fingertip point, further than the finger
 * does, which would show the background beside every fingertip. The tips are pulled back by this much
 * (hand sizes): less leaves a dark edge beyond the fingertips, more cuts into the nails.
 */
const TIP_TRIM = 0.1;
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);
/** The back of the hand, from the wrist round the knuckles. */
const PALM = [0, 1, 2, 5, 9, 13, 17];
/** With nobody at the screen for this long, outside a take, the kiosk goes back to its first screen. */
const IDLE_S = 90;

const ICONS = {
  play: publicUrl('assets/lesson/play.svg'),
  volume: publicUrl('assets/lesson/volume.svg'),
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Hand skeleton as in the design: white bones, red joints. The preview is mirrored, so x is flipped. */
function drawHands(canvas: HTMLCanvasElement, hands: ReadonlyArray<OverlayHand>): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const place = (p: { x: number; y: number }) => [(1 - p.x) * width, p.y * height] as const;

  for (const hand of hands) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    context.lineWidth = 2.5 * OVERLAY_DENSITY;
    context.lineCap = 'round';
    context.beginPath();
    for (const [from, to] of HAND_CONNECTIONS) {
      const [x1, y1] = place(hand.points[from]);
      const [x2, y2] = place(hand.points[to]);
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
    }
    context.stroke();

    context.fillStyle = '#fa3926';
    context.strokeStyle = '#fff';
    context.lineWidth = 2 * OVERLAY_DENSITY;
    for (const point of hand.points) {
      const [x, y] = place(point);
      context.beginPath();
      context.arc(x, y, 6.75 * OVERLAY_DENSITY, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
}

/** Mean distance of the tracked points (wrist and thumb base left out) from their centroid, in pixels. */
function handSize(points: ReadonlyArray<readonly [number, number]>): number {
  const reliable = points.slice(3);
  const cx = reliable.reduce((sum, p) => sum + p[0], 0) / reliable.length;
  const cy = reliable.reduce((sum, p) => sum + p[1], 0) / reliable.length;
  return reliable.reduce((sum, p) => sum + Math.hypot(p[0] - cx, p[1] - cy), 0) / reliable.length;
}

/**
 * The virtual pot is drawn over the camera picture, which would hide the hands that hold it. This
 * layer sits above the pot and shows the camera's own pixels again wherever a hand is, using a mask
 * built from the tracked skeleton, so the learner's real hands appear in front of the clay.
 */
function drawHandsInFront(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: ReadonlyArray<OverlayHand>): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, width, height);
  if (hands.length === 0 || video.videoWidth === 0) return;

  // 1. The mask: every bone as a finger-thick stroke, plus the back of the hand.
  context.save();
  context.filter = 'blur(4px)';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  for (const hand of hands) {
    const points = hand.points.map((p) => [(1 - p.x) * width, p.y * height] as const);
    const size = handSize(points);
    context.lineWidth = size * FINGER_WIDTH;
    context.beginPath();
    for (const [from, to] of HAND_CONNECTIONS) {
      const [x1, y1] = points[from];
      const [x2, y2] = points[to];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const keep = FINGERTIPS.has(to) && length > 0 ? Math.max(0.4, 1 - (TIP_TRIM * size) / length) : 1;
      context.moveTo(x1, y1);
      context.lineTo(x1 + (x2 - x1) * keep, y1 + (y2 - y1) * keep);
    }
    context.stroke();
    context.beginPath();
    for (const index of PALM) context.lineTo(points[index][0], points[index][1]);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();

  // 2. Keep the camera picture only inside the mask: the same mirrored centre crop the panel shows.
  const crop = cameraCrop(video, width / height);
  context.globalCompositeOperation = 'source-in';
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  context.restore();
  context.globalCompositeOperation = 'source-over';
}

export function LessonPage() {
  const cameraRef = useRef<HTMLVideoElement>(null);
  const lessonRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const handsRef = useRef<HTMLCanvasElement>(null);
  const coachRef = useRef<LessonCoach | null>(null);
  const sceneRef = useRef<WheelScene | null>(null);
  const startedAt = useRef(0);

  const [state, setState] = useState<CoachState>('loading');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [time, setTime] = useState<LessonTime>({ currentMs: 0, durationMs: 0 });
  const [muted, setMuted] = useState(false);
  const [result, setResult] = useState<SessionResult | null>(null);
  /** The photo step is open: countdown, the picture, sharing. */
  const [photo, setPhoto] = useState(false);

  useEffect(() => {
    const camera = cameraRef.current;
    const lesson = lessonRef.current;
    const overlay = overlayRef.current;
    const wheel = wheelRef.current;
    const handsLayer = handsRef.current;
    if (!camera || !lesson || !overlay || !wheel || !handsLayer) return;

    // three.js is only needed here, so it is not part of what the first screen downloads. The clay
    // may be on the wheel before the scene has loaded, so the latest shape is kept for it.
    let scene: WheelScene | null = null;
    let clay: ClayShape | null = null;
    let left = false;
    void import('./WheelScene')
      .then(({ WheelScene }) => {
        if (left) return;
        scene = new WheelScene(wheel, PANEL_WIDTH / PANEL_HEIGHT, PANEL_WIDTH * WHEEL_DENSITY, PANEL_HEIGHT * WHEEL_DENSITY);
        scene.setClay(clay);
        sceneRef.current = scene;
      })
      .catch((error) => console.warn('The wheel could not be drawn; the lesson runs without it.', error));
    const coach = createCoach();
    coachRef.current = coach;
    const unsubscribe = [
      coach.on('state', (next) => {
        setState(next);
        // A result belongs to the take that just ended.
        if (next !== 'finished') setResult(null);
      }),
      coach.on('feedback', setFeedback),
      coach.on('time', setTime),
      coach.on('result', setResult),
      // Drawn straight to the canvas: thirty updates a second should not go through React.
      coach.on('hands', (hands) => {
        drawHandsInFront(handsLayer, camera, hands);
        drawHands(overlay, hands);
        // Somebody holding their hands up is still here, even without touching the screen.
        if (hands.length) pokeIdle();
      }),
      coach.on('clay', (shape) => {
        clay = shape;
        scene?.setClay(shape);
      }),
    ];
    void coach.init({ cameraVideo: camera, lessonVideo: lesson, viewAspect: PANEL_WIDTH / PANEL_HEIGHT });

    return () => {
      unsubscribe.forEach((off) => off());
      left = true;
      coach.dispose();
      scene?.dispose();
      sceneRef.current = null;
      coachRef.current = null;
    };
  }, []);

  const busy = state === 'countdown' || state === 'running';
  const unavailable = state === 'loading' || state === 'error';
  /** No take is running and the photo step is closed: the screen says what can be done next. */
  const resting = !photo && (state === 'ready' || state === 'finished' || state === 'error');
  /** The take was scored, so there is a pot on the wheel to be photographed with. */
  const madePot = result !== null && result.score !== null && result.shapeScore !== null;
  const scores = madePot ? `동작 ${result.score}% · 모양 ${result.shapeScore}%` : null;

  const onPlay = () => {
    const coach = coachRef.current;
    if (!coach) return;
    if (busy) {
      // The second click of a double-click must not cancel the take it just started.
      if (performance.now() - startedAt.current < 500) return;
      coach.stop();
    } else {
      startedAt.current = performance.now();
      coach.start();
    }
  };

  const onVolume = () => {
    const next = !muted;
    setMuted(next);
    coachRef.current?.setMuted(next);
  };

  const capture = useCallback(() => {
    const camera = cameraRef.current;
    const handsLayer = handsRef.current;
    if (!camera || !handsLayer) return Promise.reject(new Error('the lesson screen is gone'));
    const scene = sceneRef.current;
    return composeSouvenir({
      video: camera,
      drawWheel: scene ? (context, x, y, width, height) => scene.drawTo(context, x, y, width, height) : null,
      hands: handsLayer,
      aspect: PANEL_WIDTH / PANEL_HEIGHT,
      caption: { title: EXPERIENCE.photoTitle, place: EXPERIENCE.photoPlace, scores, brand: '이음' },
    });
  }, [scores]);

  return (
    <>
      {/* Outside the stage: its notice is sized by the display, and the stage is scaled. */}
      <IdleReturn seconds={IDLE_S} enabled={!busy && !photo} />
      <KioskStage height={STAGE_HEIGHT}>
        <main className={styles.page} data-testid="lesson-page" data-coach-state={state}>
          <header className={styles.header}>
            <h1 className={styles.title}>{EXPERIENCE.title}</h1>
            <p className={styles.course}>{EXPERIENCE.guide}</p>
          </header>
          {!unavailable && (
            <p className={styles.cameraNote}>
              <span className={styles.cameraDot} aria-hidden="true" />
              카메라 사용 중 · 영상은 저장하지 않아요
            </p>
          )}
          <a className={`${ui.ghost} ${styles.home}`} href={ROUTES.home} data-testid="go-home">
            처음으로
          </a>

          <section className={styles.cameraPanel} aria-label="내 동작" data-testid="camera-panel">
            <video ref={cameraRef} className={styles.cameraVideo} muted playsInline data-testid="camera-video" />
            <div ref={wheelRef} className={styles.overlay} />
            <canvas ref={handsRef} className={styles.overlay} width={PANEL_WIDTH} height={PANEL_HEIGHT} />
            {/* The skeleton is a guide for the take; it is not part of the visitor's photo. */}
            <canvas
              ref={overlayRef}
              className={styles.overlay}
              style={{ visibility: photo ? 'hidden' : 'visible' }}
              width={PANEL_WIDTH * OVERLAY_DENSITY}
              height={PANEL_HEIGHT * OVERLAY_DENSITY}
              data-testid="hand-overlay"
            />
          </section>
          <section className={styles.artisanPanel} aria-label="장인">
            <video ref={lessonRef} className={styles.video} playsInline data-testid="lesson-video" />
            {resting && <div className={styles.nextShade} />}
          </section>
          <p className={styles.cameraLabel}>내 동작</p>
          <p className={styles.artisanLabel}>장인</p>

          {feedback && feedback.message && (
            <p
              className={styles.pill}
              role="status"
              aria-live="polite"
              data-testid="feedback-pill"
              data-tone={feedback.tone}
              data-code={feedback.code}
            >
              {feedback.message}
            </p>
          )}

          <div className={styles.controls}>
            <button
              type="button"
              className={styles.playButton}
              onClick={onPlay}
              disabled={unavailable}
              aria-label={busy ? '멈추기' : '따라 하기 시작'}
              data-testid="play-button"
            >
              <img src={ICONS.play} alt="" />
            </button>
            <button
              type="button"
              className={styles.volumeButton}
              onClick={onVolume}
              aria-label="소리"
              aria-pressed={muted}
              data-testid="volume-button"
            >
              <img src={ICONS.volume} alt="" />
            </button>
            <p className={styles.time} data-testid="lesson-time">
              {clock(time.currentMs)} / {clock(time.durationMs)}
            </p>
          </div>

          {/*
            The next step, in words, whenever no take is running: start; after a take the photo with
            the pot or another try; and always a way on for someone who cannot or will not do the take.
          */}
          {resting && (
            <div className={styles.next} data-testid="next-actions">
              {state === 'ready' && (
                <button type="button" className={`${ui.primary} ${styles.wide}`} onClick={onPlay} data-testid="start-take">
                  따라 하기 시작
                </button>
              )}
              {state === 'finished' && madePot && (
                <button type="button" className={`${ui.primary} ${styles.wide}`} onClick={() => setPhoto(true)} data-testid="take-photo">
                  작품과 사진 찍기
                  <span aria-hidden="true">→</span>
                </button>
              )}
              {state === 'finished' && (
                <button type="button" className={madePot ? ui.ghost : `${ui.primary} ${styles.wide}`} onClick={onPlay} data-testid="retry">
                  다시 해 보기
                </button>
              )}
              <button
                type="button"
                className={`${ui.ghost} ${state === 'finished' && madePot ? '' : styles.wide}`}
                onClick={() => go(ROUTES.artisan)}
                data-testid="skip"
              >
                {state === 'finished' ? '건너뛰기' : '체험 없이 장인 소개 보기'}
              </button>
            </div>
          )}

          {photo && <PhotoStep capture={capture} onDone={() => go(ROUTES.artisan)} onCancel={() => setPhoto(false)} />}
        </main>
      </KioskStage>
    </>
  );
}
