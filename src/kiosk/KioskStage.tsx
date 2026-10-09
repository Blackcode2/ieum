import { useEffect, useState, type ReactNode } from 'react';
import styles from './KioskStage.module.css';

const STAGE_WIDTH = 1920;

interface KioskStageProps {
  /** Height of the stage in design pixels; the width is always 1920. */
  height?: number;
  background?: string;
  /** Fills the whole display behind the stage, so a photo still reaches the edges on a display of another shape. */
  backdrop?: ReactNode;
  children: ReactNode;
}

function fit(height: number): number {
  return Math.min(document.documentElement.clientWidth / STAGE_WIDTH, window.innerHeight / height);
}

/**
 * One kiosk screen: a fixed stage laid out in design pixels, scaled to fit the display and centred.
 * Nothing scrolls and nothing can be selected, as on a touch screen in a museum.
 */
export function KioskStage({ height = 1080, background = '#171717', backdrop, children }: KioskStageProps) {
  const [scale, setScale] = useState(() => fit(height));

  useEffect(() => {
    const onResize = () => setScale(fit(height));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [height]);

  // The page behind the stage takes its colour, so nothing white shows around a dark screen.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.backgroundColor;
    root.style.backgroundColor = background;
    return () => {
      root.style.backgroundColor = previous;
    };
  }, [background]);

  return (
    <div className={styles.viewport} style={{ background }}>
      {backdrop && <div className={styles.backdrop}>{backdrop}</div>}
      <div className={styles.stage} style={{ height, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
