// Hash routes: the app is served as static files, also from a subfolder, so paths cannot be used.
export const ROUTES = {
  /** Kiosk start: the museum, the artwork this kiosk stands next to, and the way into the experience. */
  home: '#/',
  /** Following the master's hands at the virtual wheel, then a photo with the finished pot. */
  lesson: '#/lesson',
  /** The master and the class they teach. */
  artisan: '#/artisan',
  /** The ieum class site (the earlier landing page), where a visitor applies. */
  ieum: '#/ieum',
} as const;

/**
 * Changes the screen without adding to the browser's history: on a shared device the next visitor's
 * back gesture must not walk through the last visitor's screens.
 */
export function go(route: string): void {
  window.location.replace(route);
}
