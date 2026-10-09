import { useEffect, useRef, useState } from 'react';
import ui from '../../kiosk/ui.module.css';
import { ROUTES, go } from '../../routes';
import styles from './PhotoStep.module.css';
import { canShareFiles, shareSouvenir } from './souvenir';

const COUNTDOWN_S = 3;
/** The finished photo stays this long before the kiosk moves on by itself, */
const REVIEW_S = 20;
/** and this long once the visitor has taken it with them. */
const HANDED_OVER_S = 8;
/** Taking the picture, and the device's share sheet, are given up on after this long. */
const CAPTURE_LIMIT_MS = 8000;
const SHARE_LIMIT_MS = 60_000;

interface PhotoStepProps {
  /** Takes the picture: the camera frame with the pot and the hands in front, as a finished card. */
  capture: () => Promise<Blob>;
  /** The visitor is done with the photo, or the time ran out. */
  onDone: () => void;
  /** The visitor backed out before a picture was taken. */
  onCancel: () => void;
}

/** Rejects if `work` has not settled in time, so that no step of the photo can hold the kiosk for good. */
function within<T>(work: Promise<T>, limitMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`no answer after ${limitMs} ms`)), limitMs);
    work.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

/**
 * After a take: a countdown over the camera picture, the photo with the pot the visitor made, and
 * the choice to share it, take it again or go on. Laid over the lesson screen, which keeps the
 * camera and the pot alive underneath. Whatever happens, the step ends by itself: a visitor's
 * photo must not stay on a public screen.
 */
export function PhotoStep({ capture, onDone, onCancel }: PhotoStepProps) {
  const [round, setRound] = useState(0);
  const [count, setCount] = useState(COUNTDOWN_S);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REVIEW_S);
  const [sharing, setSharing] = useState(false);
  const [handedOver, setHandedOver] = useState<'shared' | 'saved' | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  /** Counts touches on the finished photo; each one starts the wait again. */
  const [touches, setTouches] = useState(0);
  const captureRef = useRef(capture);
  const onDoneRef = useRef(onDone);
  captureRef.current = capture;
  onDoneRef.current = onDone;

  // Three, two, one, then the picture.
  useEffect(() => {
    let cancelled = false;
    let remaining = COUNTDOWN_S;
    setCount(remaining);
    const timer = window.setInterval(() => {
      remaining -= 1;
      setCount(remaining);
      if (remaining > 0) return;
      window.clearInterval(timer);
      within(captureRef.current(), CAPTURE_LIMIT_MS).then(
        (blob) => {
          if (!cancelled) setPhoto({ blob, url: URL.createObjectURL(blob) });
        },
        (error) => {
          console.error('Photo: the picture could not be taken', error);
          if (!cancelled) setFailed(true);
        },
      );
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [round]);

  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

  // With the photo (or the news that there is none) on screen, the kiosk goes on by itself, except
  // while the share sheet is open.
  useEffect(() => {
    if ((!photo && !failed) || sharing) return;
    let remaining = handedOver ? HANDED_OVER_S : REVIEW_S;
    setSecondsLeft(remaining);
    const timer = window.setInterval(() => {
      remaining -= 1;
      setSecondsLeft(remaining);
      if (remaining > 0) return;
      window.clearInterval(timer);
      onDoneRef.current();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [photo, failed, sharing, handedOver, touches]);

  // A device that is put to sleep or covered with the photo on screen would show it to whoever
  // wakes it: the photo is dropped and the kiosk starts over.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) go(ROUTES.home);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const retake = () => {
    setPhoto(null);
    setFailed(false);
    setHandedOver(null);
    setShareFailed(false);
    setRound((n) => n + 1);
  };

  const share = async () => {
    if (!photo || sharing) return;
    setSharing(true);
    // A share sheet that is left open counts as not shared; the wait for the next screen then resumes.
    const outcome = await within(shareSouvenir(photo.blob), SHARE_LIMIT_MS).catch(() => 'cancelled' as const);
    if (outcome === 'shared' || outcome === 'saved') setHandedOver(outcome);
    setShareFailed(outcome === 'failed');
    setSharing(false);
  };

  const timer = (
    <p className={styles.timer} data-testid="photo-timer">
      {sharing ? '공유를 마치면 다음으로 넘어가요' : `${secondsLeft}초 뒤 자동으로 넘어가요`}
    </p>
  );
  const home = (
    <a className={styles.home} href={ROUTES.home} data-testid="photo-home">
      처음으로
    </a>
  );

  if (failed) {
    return (
      <div
        className={styles.review}
        role="alertdialog"
        aria-label="사진을 찍지 못했어요"
        data-testid="photo-failed"
        onPointerDown={() => setTouches((n) => n + 1)}
      >
        <div className={styles.side}>
          <h2 className={`${ui.display} ${styles.heading}`}>사진을 찍지 못했어요</h2>
          <p className={styles.text}>다시 찍거나, 사진 없이 다음으로 넘어갈 수 있어요.</p>
          <div className={styles.actions}>
            <button type="button" className={ui.primary} onClick={retake}>
              다시 찍기
            </button>
            <button type="button" className={ui.ghost} onClick={onDone}>
              사진 없이 넘어가기
            </button>
          </div>
          {timer}
          {home}
        </div>
      </div>
    );
  }

  if (!photo) {
    return (
      <div className={styles.shoot} data-testid="photo-countdown">
        <p className={styles.pose}>내가 빚은 도자기 옆에서 포즈를 잡아 주세요</p>
        {count > 0 ? (
          <p key={count} className={`${ui.digit} ${styles.count}`} aria-live="assertive">
            {count}
          </p>
        ) : (
          <div className={styles.flash} />
        )}
        {count > 0 && (
          <button type="button" className={`${ui.ghost} ${styles.cancel}`} onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.review}
      role="dialog"
      aria-label="내가 빚은 도자기 사진"
      data-testid="photo-review"
      onPointerDown={() => setTouches((n) => n + 1)}
    >
      <img
        className={styles.print}
        src={photo.url}
        alt="방금 찍은 사진: 내가 빚은 도자기와 함께"
        draggable={false}
        data-testid="photo-print"
      />
      <div className={styles.side}>
        <h2 className={`${ui.display} ${styles.heading}`}>사진이 나왔어요</h2>
        <p className={styles.text} data-testid="photo-note">
          {shareFailed
            ? '사진을 공유하지 못했어요. 다시 눌러 볼 수 있어요.'
            : handedOver === 'shared'
              ? '사진을 공유했어요.'
              : handedOver === 'saved'
                ? '사진을 이 기기에 내려받았어요.'
                : '사진은 저장하거나 공유하지 않으면 다음 화면에서 지워져요.'}
        </p>
        <div className={styles.actions}>
          <button type="button" className={ui.primary} onClick={share} disabled={sharing} data-testid="photo-share">
            {canShareFiles() ? '공유하기' : '사진 저장하기'}
          </button>
          <button type="button" className={ui.ghost} onClick={retake} disabled={sharing} data-testid="photo-retake">
            다시 찍기
          </button>
          <button type="button" className={ui.ghost} onClick={onDone} disabled={sharing} data-testid="photo-next">
            다음으로 <span aria-hidden="true">→</span>
          </button>
        </div>
        {timer}
        {home}
      </div>
    </div>
  );
}
