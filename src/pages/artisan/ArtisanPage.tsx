import { useEffect, useState } from 'react';
import { ARTISAN, CLASS, EVENT, GOODS } from '../../data/museum';
import { KioskStage } from '../../kiosk/KioskStage';
import { IdleReturn } from '../../kiosk/idle';
import ui from '../../kiosk/ui.module.css';
import { publicUrl } from '../../publicUrl';
import { ROUTES } from '../../routes';
import styles from './ArtisanPage.module.css';

/** Nobody is here any more after this long without a touch; the kiosk goes back to its first screen. */
const IDLE_S = 60;
/** How long the answer to "굿즈 보기" stays on the screen. */
const GOODS_NOTE_MS = 4000;

/**
 * Shown by itself after the photo: who the master is whose hands the visitor just followed, the
 * event for the photo they took, and the ways on: the class, the goods, or back to the start.
 */
export function ArtisanPage() {
  const [goodsNote, setGoodsNote] = useState(0);

  useEffect(() => {
    if (!goodsNote) return;
    const timer = window.setTimeout(() => setGoodsNote(0), GOODS_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [goodsNote]);

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
            <div className={styles.who}>
              <img className={styles.portrait} src={publicUrl(ARTISAN.photo.src)} alt={ARTISAN.photo.alt} draggable={false} />
              <div>
                <p className={styles.eyebrow}>{ARTISAN.eyebrow}</p>
                <h1 id="artisan-name" className={`${ui.display} ${styles.name}`}>
                  {ARTISAN.name}
                </h1>
                <p className={styles.field}>{ARTISAN.field}</p>
              </div>
            </div>
            <p className={styles.intro}>{ARTISAN.intro}</p>
          </section>

          <section className={styles.event} aria-labelledby="event-title" data-testid="event-banner">
            <p className={styles.eventLabel}>{EVENT.label}</p>
            <h2 id="event-title" className={`${ui.display} ${styles.eventTitle}`}>
              {EVENT.title.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
            <ol className={styles.eventSteps}>
              {EVENT.steps.map((step, i) => (
                <li key={step}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>

          <div className={styles.actions}>
            <a className={ui.primary} href={ROUTES.ieum} data-testid="apply">
              {CLASS.apply}
              <span aria-hidden="true">→</span>
            </a>
            <button type="button" className={`${ui.ghost} ${styles.goods}`} onClick={() => setGoodsNote((n) => n + 1)} data-testid="goods">
              {GOODS.open}
            </button>
            <a className={`${ui.ghost} ${styles.home}`} href={ROUTES.home} data-testid="go-home">
              처음으로
            </a>
          </div>
          {goodsNote > 0 && (
            <p className={styles.goodsNote} role="status" data-testid="goods-note">
              {GOODS.soon}
            </p>
          )}
        </main>
      </KioskStage>
    </>
  );
}
