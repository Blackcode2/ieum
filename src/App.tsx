import { useEffect, useRef, useState } from 'react';
import { HomeButton } from './kiosk/HomeButton';
import { FreshStart, IdleReturn } from './kiosk/idle';
import { ArtisanPage } from './pages/artisan/ArtisanPage';
import { LessonPage } from './pages/lesson/LessonPage';
import { MainPage } from './pages/main/MainPage';
import { MuseumHome } from './pages/museum/MuseumHome';
import { ROUTES, go } from './routes';

/** On the class site a visitor reads and scrolls, so the kiosk waits longer before it starts over. */
const SITE_IDLE_S = 120;
/**
 * After a screen change, taps are ignored this long. The second tap of a double tap would otherwise
 * press whatever the next screen has in the same place (taps half a second apart still did).
 */
const TAP_GUARD_MS = 700;
/** After visitors, a kiosk left alone on its first screen this long loads itself afresh. */
const FRESH_START_S = 300;

function currentRoute(): string {
  return window.location.hash.replace(/\?.*$/, '') || ROUTES.home;
}

/**
 * The kiosk's screens in the order a visitor meets them: the artwork, the experience with its
 * photo, the master and their class, and the class site to apply on.
 */
export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [guarded, setGuarded] = useState(false);
  const visited = useRef(false);
  if (route !== ROUTES.home) visited.current = true;

  useEffect(() => {
    let guard = 0;
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
      setGuarded(true);
      window.clearTimeout(guard);
      guard = window.setTimeout(() => setGuarded(false), TAP_GUARD_MS);
    };
    // Links between the screens change the screen the same way the buttons do: see go().
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      if (!link) return;
      event.preventDefault();
      go(link.getAttribute('href') ?? ROUTES.home);
    };
    // A long press must not open the browser's own menu.
    const onMenu = (event: Event) => event.preventDefault();
    window.addEventListener('hashchange', onChange);
    document.addEventListener('click', onClick);
    window.addEventListener('contextmenu', onMenu);
    return () => {
      window.clearTimeout(guard);
      window.removeEventListener('hashchange', onChange);
      document.removeEventListener('click', onClick);
      window.removeEventListener('contextmenu', onMenu);
    };
  }, []);

  return (
    <>
      {screen(route, visited.current)}
      {guarded && <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} aria-hidden="true" />}
    </>
  );
}

function screen(route: string, visited: boolean) {
  switch (route) {
    case ROUTES.lesson:
      return <LessonPage />;
    case ROUTES.artisan:
      return <ArtisanPage />;
    case ROUTES.ieum:
      return (
        <>
          <IdleReturn seconds={SITE_IDLE_S} />
          <MainPage />
          <HomeButton />
        </>
      );
    default:
      return (
        <>
          <FreshStart seconds={FRESH_START_S} enabled={visited} />
          <MuseumHome />
        </>
      );
  }
}
