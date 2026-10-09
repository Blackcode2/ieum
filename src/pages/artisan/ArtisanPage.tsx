import { ARTISAN, CLASS } from '../../data/museum';
import { KioskStage } from '../../kiosk/KioskStage';
import { IdleReturn } from '../../kiosk/idle';
import ui from '../../kiosk/ui.module.css';
import { publicUrl } from '../../publicUrl';
import { ROUTES } from '../../routes';
import styles from './ArtisanPage.module.css';

/** Nobody is here any more after this long without a touch; the kiosk goes back to its first screen. */
const IDLE_S = 60;

/** "09:48" -> seconds. */
function seconds(duration: string): number {
  const [minutes, rest] = duration.split(':').map(Number);
  return minutes * 60 + rest;
}

function totalLength(durations: ReadonlyArray<string>): string {
  const minutes = Math.round(durations.reduce((sum, d) => sum + seconds(d), 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `약 ${hours}시간 ${minutes % 60}분` : `약 ${minutes}분`;
}

/**
 * Shown by itself after the photo: who the master is whose hands the visitor just followed, the
 * class they teach, and the way to apply.
 */
export function ArtisanPage() {
  return (
    <>
      <IdleReturn seconds={IDLE_S} />
      <KioskStage>
        <main className={styles.screen} data-testid="artisan-page">
          <figure className={styles.clip}>
            <video src={publicUrl(ARTISAN.clip)} autoPlay loop muted playsInline />
            <figcaption className={styles.clipLabel}>{ARTISAN.clipLabel}</figcaption>
          </figure>

          <section className={styles.about} aria-labelledby="artisan-name">
            <p className={styles.eyebrow}>{ARTISAN.eyebrow}</p>
            <h1 id="artisan-name" className={`${ui.display} ${styles.name}`}>
              {ARTISAN.name}
            </h1>
            <p className={styles.field}>{ARTISAN.field}</p>
            <p className={styles.intro}>{ARTISAN.intro}</p>
          </section>

          <section className={styles.course} aria-labelledby="class-title">
            <p className={styles.courseLabel}>{CLASS.label}</p>
            <h2 id="class-title" className={styles.courseTitle}>
              {CLASS.title}
            </h2>
            <p className={styles.courseMeta}>
              {CLASS.format} · 총 {CLASS.lessons.length}강 · {totalLength(CLASS.lessons.map((lesson) => lesson.duration))}
            </p>
            <ol className={styles.lessons}>
              {CLASS.lessons.map((lesson) => (
                <li key={lesson.title} className={lesson.title === CLASS.experienced ? styles.experienced : undefined}>
                  <span className={styles.lessonTitle}>{lesson.title}</span>
                  {lesson.title === CLASS.experienced && <span className={styles.tag}>이 체험의 동작</span>}
                </li>
              ))}
            </ol>
          </section>

          <div className={styles.actions}>
            <a className={ui.primary} href={ROUTES.ieum} data-testid="apply">
              {CLASS.apply}
              <span aria-hidden="true">→</span>
            </a>
            <a className={`${ui.ghost} ${styles.home}`} href={ROUTES.home} data-testid="go-home">
              처음으로
            </a>
          </div>
        </main>
      </KioskStage>
    </>
  );
}
