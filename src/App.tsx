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

/** Fills the whole display, or leaves that again. Older Safari only knows the prefixed names. */
function toggleFullscreen(): void {
  const page = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement ?? page.webkitFullscreenElement) {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else page.webkitExitFullscreen?.();
  } else if (root.requestFullscreen) {
    void root.requestFullscreen().catch((error) => console.warn('Full screen was refused', error));
  } else {
    root.webkitRequestFullscreen?.();
  }
}

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
    // F on a keyboard switches full screen, for setting the kiosk up. The key is read by its place
    // on the keyboard, so it also works while the keyboard is set to Korean.
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyF' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      toggleFullscreen();
    };
    window.addEventListener('hashchange', onChange);
    document.addEventListener('click', onClick);
    window.addEventListener('contextmenu', onMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(guard);
      window.removeEventListener('hashchange', onChange);
      document.removeEventListener('click', onClick);
      window.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('keydown', onKey);
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
