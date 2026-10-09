import { useEffect, useState } from 'react';
import { ROUTES, go } from '../routes';
import styles from './idle.module.css';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** A return to the first screen is announced this long ahead, with a way to stay. */
const WARNING_S = 20;

let lastActivity = performance.now();

/** Marks activity that is not a touch, such as hands seen by the camera. */
export function pokeIdle(): void {
  lastActivity = performance.now();
}

/**
 * A kiosk must not stay on the last visitor's screen: after `seconds` without a touch the app
 * returns to the first screen. Returns the seconds left, for the notice.
 */
export function useIdleReturn(seconds: number, enabled = true): number {
  const [secondsLeft, setSecondsLeft] = useState(seconds);

  useEffect(() => {
    pokeIdle();
    setSecondsLeft(seconds);
    if (!enabled) return;
    const options = { capture: true, passive: true } as const;
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, pokeIdle, options));
    const timer = window.setInterval(() => {
      const left = Math.ceil(seconds - (performance.now() - lastActivity) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) go(ROUTES.home);
    }, 500);
    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, pokeIdle, options));
      window.clearInterval(timer);
    };
  }, [seconds, enabled]);

  return secondsLeft;
}

/**
 * The same rule with its own notice: shows nothing until the last twenty seconds, then says so
 * and offers to stay. Kept apart from the screen so that the screen does not re-render every second.
 */
export function IdleReturn({ seconds, enabled = true }: { seconds: number; enabled?: boolean }) {
  const secondsLeft = useIdleReturn(seconds, enabled);
  if (!enabled || secondsLeft > WARNING_S) return null;
  return (
    <div className={styles.notice} role="alert" data-testid="idle-warning">
      <p>{secondsLeft}초 뒤 처음 화면으로 돌아가요</p>
      {/* Any touch counts as staying; the button is there so that it can be seen and reached. */}
      <button type="button" className={styles.stay} onClick={pokeIdle}>
        계속 보기
      </button>
    </div>
  );
}
