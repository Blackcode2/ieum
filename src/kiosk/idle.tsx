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
function useIdleReturn(seconds: number, enabled: boolean): number {
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
 * For the first screen, once visitors have been: when nobody has touched the kiosk for `seconds`,
 * the page loads itself afresh. A page that is never reloaded slowly piles up memory, and a reload
 * on the first screen is seen by nobody.
 */
export function FreshStart({ seconds, enabled }: { seconds: number; enabled: boolean }): null {
  useEffect(() => {
    if (!enabled) return;
    pokeIdle();
    const options = { capture: true, passive: true } as const;
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, pokeIdle, options));
    const timer = window.setInterval(() => {
      if (performance.now() - lastActivity >= seconds * 1000) window.location.reload();
    }, 5000);
    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, pokeIdle, options));
      window.clearInterval(timer);
    };
  }, [seconds, enabled]);
  return null;
}

/**
 * That rule with its notice: shows nothing until the last twenty seconds, then says so and offers
 * to stay. A component of its own, so that the screen under it does not re-render every second.
 */
export function IdleReturn({ seconds, enabled = true }: { seconds: number; enabled?: boolean }) {
  const secondsLeft = useIdleReturn(seconds, enabled);
  if (!enabled || secondsLeft > WARNING_S) return null;
  return (
    <div className={styles.notice} role="alert" data-testid="idle-warning">
      <p>{secondsLeft}초 뒤 처음 화면으로 돌아가요</p>
      {/* Any touch counts as staying; the button is there so that it can be seen and reached. */}
      <button type="button" className={styles.stay} onClick={pokeIdle}>
        계속하기
      </button>
    </div>
  );
}
