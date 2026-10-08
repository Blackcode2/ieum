import { useEffect, useRef, useState } from 'react';
import { ScaledCanvas } from '../../components/ScaledCanvas';
import { HAND_CONNECTIONS, createCoach, type CoachState, type Feedback, type LessonCoach, type LessonTime, type OverlayHand } from '../../cv';
import { CURRICULUM, LESSON } from '../../data/lesson';
import { publicUrl } from '../../publicUrl';
import styles from './LessonPage.module.css';

const FRAME_HEIGHT = 2632;
/** Header, both panels and the player controls: what has to be on screen without scrolling. */
const FIT_HEIGHT = 1212;
const PANEL_WIDTH = 1146;
const PANEL_HEIGHT = 1027;
/** Backing-store pixels per design pixel, so the skeleton stays sharp when the frame is scaled. */
const OVERLAY_DENSITY = 2;

const ICONS = {
  play: publicUrl('assets/lesson/play.svg'),
  volume: publicUrl('assets/lesson/volume.svg'),
  lesson: publicUrl('assets/lesson/curriculum-play.svg'),
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

export function LessonPage() {
  const cameraRef = useRef<HTMLVideoElement>(null);
  const lessonRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const coachRef = useRef<LessonCoach | null>(null);
  const startedAt = useRef(0);

  const [state, setState] = useState<CoachState>('loading');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [time, setTime] = useState<LessonTime>({ currentMs: 0, durationMs: 0 });
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const camera = cameraRef.current;
    const lesson = lessonRef.current;
    const overlay = overlayRef.current;
    if (!camera || !lesson || !overlay) return;

    const coach = createCoach();
    coachRef.current = coach;
    const unsubscribe = [
      coach.on('state', setState),
      coach.on('feedback', setFeedback),
      coach.on('time', setTime),
      // Drawn straight to the canvas: thirty updates a second should not go through React.
      coach.on('hands', (hands) => drawHands(overlay, hands)),
    ];
    void coach.init({ cameraVideo: camera, lessonVideo: lesson, viewAspect: PANEL_WIDTH / PANEL_HEIGHT });

    return () => {
      unsubscribe.forEach((off) => off());
      coach.dispose();
      coachRef.current = null;
    };
  }, []);

  const busy = state === 'countdown' || state === 'running';
  const unavailable = state === 'loading' || state === 'error';

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

  return (
    <ScaledCanvas height={FRAME_HEIGHT} fitHeight={FIT_HEIGHT} background="#171717">
      <main className={styles.page} data-testid="lesson-page" data-coach-state={state}>
        <header className={styles.header}>
          <h1 className={styles.title}>{LESSON.title}</h1>
          <p className={styles.course}>{LESSON.course}</p>
        </header>

        <section className={styles.cameraPanel} aria-label="내 동작">
          <video ref={cameraRef} className={styles.cameraVideo} muted playsInline data-testid="camera-video" />
          <canvas
            ref={overlayRef}
            className={styles.overlay}
            width={PANEL_WIDTH * OVERLAY_DENSITY}
            height={PANEL_HEIGHT * OVERLAY_DENSITY}
            data-testid="hand-overlay"
          />
        </section>
        <section className={styles.artisanPanel} aria-label="장인">
          <video ref={lessonRef} className={styles.video} playsInline data-testid="lesson-video" />
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

        <h2 className={styles.curriculumTitle}>커리큘럼</h2>
        <ul className={styles.curriculum}>
          {CURRICULUM.map((item) => (
            <li key={item.title} className={styles.lesson}>
              <img src={ICONS.lesson} alt="" />
              <div className={styles.lessonText}>
                <p className={styles.lessonTitle}>{item.title}</p>
                <p className={styles.lessonDuration}>{item.duration}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </ScaledCanvas>
  );
}
