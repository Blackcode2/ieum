import { useEffect, useState } from 'react';
import { HomeButton } from './kiosk/HomeButton';
import { IdleReturn } from './kiosk/idle';
import { ArtisanPage } from './pages/artisan/ArtisanPage';
import { LessonPage } from './pages/lesson/LessonPage';
import { MainPage } from './pages/main/MainPage';
import { MuseumHome } from './pages/museum/MuseumHome';
import { ROUTES } from './routes';

/** On the class site a visitor reads and scrolls, so the kiosk waits longer before it starts over. */
const SITE_IDLE_S = 120;

function currentRoute(): string {
  return window.location.hash.replace(/\?.*$/, '') || ROUTES.home;
}

/**
 * The kiosk's screens in the order a visitor meets them: the artwork, the experience with its
 * photo, the master and their class, and the class site to apply on.
 */
export function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

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
      return <MuseumHome />;
  }
}
