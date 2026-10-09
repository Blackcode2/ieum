import { ROUTES } from '../routes';
import styles from './HomeButton.module.css';

/** The way back to the kiosk's first screen from a page that scrolls; stays in the corner of the display. */
export function HomeButton() {
  return (
    <a className={styles.home} href={ROUTES.home} data-testid="go-home">
      처음으로
    </a>
  );
}
