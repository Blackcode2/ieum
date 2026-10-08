import { useEffect, useState } from 'react';
import { LessonPage } from './pages/lesson/LessonPage';
import { MainPage } from './pages/main/MainPage';

export const ROUTES = { main: '#/', lesson: '#/lesson' } as const;

function currentRoute(): string {
  return window.location.hash.replace(/\?.*$/, '') || ROUTES.main;
}

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

  return route === ROUTES.lesson ? <LessonPage /> : <MainPage />;
}
