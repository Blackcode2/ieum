import { ARTWORK, EXPERIENCE, MUSEUM } from '../../data/museum';
import { KioskStage } from '../../kiosk/KioskStage';
import ui from '../../kiosk/ui.module.css';
import { publicUrl } from '../../publicUrl';
import { ROUTES } from '../../routes';
import styles from './MuseumHome.module.css';

/**
 * The kiosk's first screen. It stands next to one artwork: the museum and its photo, what the
 * artwork is, and below that the way into following the master's hands.
 */
export function MuseumHome() {
  return (
    <KioskStage
      background="#11100e"
      backdrop={
        <>
          <img className={styles.hero} src={publicUrl(MUSEUM.hero.src)} alt="" draggable={false} />
          <div className={styles.shade} />
        </>
      }
    >
      <main className={styles.screen} data-testid="museum-home">
        <header className={styles.museum}>
          <div>
            <p className={`${ui.display} ${styles.museumName}`}>{MUSEUM.name}</p>
            <p className={styles.museumEnglish}>{MUSEUM.englishName}</p>
          </div>
          <p className={`${ui.display} ${styles.brand}`}>이음</p>
          <p className={`${ui.chip} ${styles.demo}`} data-testid="demo-notice">
            시연용
          </p>
        </header>

        <section className={styles.lead}>
          <h1 className={`${ui.display} ${styles.headline}`}>
            {EXPERIENCE.headline.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h1>
          <p className={styles.sub}>{EXPERIENCE.lead}</p>
          <p className={styles.disclaimer}>{EXPERIENCE.disclaimer}</p>
        </section>
        <p className={styles.credits}>
          <span>{MUSEUM.demoNotice}</span>
          <span>{MUSEUM.hero.credit}</span>
          <span>
            {ARTWORK.photo.credit} · {MUSEUM.fontCredit}
          </span>
        </p>

        <article className={styles.card} aria-labelledby="artwork-title">
          <div className={styles.work}>
            <img className={styles.photo} src={publicUrl(ARTWORK.photo.src)} alt={ARTWORK.photo.alt} draggable={false} />
            <div>
              <ul className={styles.chips}>
                {ARTWORK.labels.map((label) => (
                  <li key={label} className={ui.chip}>
                    {label}
                  </li>
                ))}
              </ul>
              <h2 id="artwork-title" className={`${ui.display} ${styles.title}`}>
                {ARTWORK.title}
              </h2>
              <ul className={styles.facts}>
                {ARTWORK.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className={styles.description}>{ARTWORK.description}</p>
          <ol className={styles.steps} aria-label="체험 순서">
            {EXPERIENCE.steps.map((step, i) => (
              <li key={step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <a className={`${ui.primary} ${styles.start}`} href={ROUTES.lesson} data-testid="start-experience">
            {EXPERIENCE.start}
            <span aria-hidden="true">→</span>
          </a>
          <p className={styles.note}>{EXPERIENCE.note}</p>
        </article>
      </main>
    </KioskStage>
  );
}
