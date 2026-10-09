import { useEffect, useRef, useState } from 'react';
import ui from '../../kiosk/ui.module.css';
import { ROUTES } from '../../routes';
import styles from './PhotoStep.module.css';
import { canShareFiles, shareSouvenir } from './souvenir';

const COUNTDOWN_S = 3;
/** The finished photo stays this long before the kiosk moves on by itself, */
const REVIEW_S = 20;
/** and this long once the visitor has taken it with them. */
const HANDED_OVER_S = 8;

interface PhotoStepProps {
  /** Takes the picture: the camera frame with the pot and the hands in front, as a finished card. */
  capture: () => Promise<Blob>;
  /** The visitor is done with the photo, or the time ran out. */
  onDone: () => void;
  /** The visitor backed out before a picture was taken. */
  onCancel: () => void;
}

/**
 * After a take: a countdown over the camera picture, the photo with the pot the visitor made, and
 * the choice to share it, take it again or go on. Laid over the lesson screen, which keeps the
 * camera and the pot alive underneath.
 */
export function PhotoStep({ capture, onDone, onCancel }: PhotoStepProps) {
  const [round, setRound] = useState(0);
  const [count, setCount] = useState(COUNTDOWN_S);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REVIEW_S);
  const [sharing, setSharing] = useState(false);
  const [handedOver, setHandedOver] = useState<'shared' | 'saved' | null>(null);
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
      captureRef.current().then(
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

  // The photo does not stay on a public screen: the kiosk goes on by itself, except while the
  // share sheet is open.
  useEffect(() => {
    if (!photo || sharing) return;
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
  }, [photo, sharing, handedOver, touches]);

  const retake = () => {
    setPhoto(null);
    setFailed(false);
    setHandedOver(null);
    setRound((n) => n + 1);
  };

  const share = async () => {
    if (!photo || sharing) return;
    setSharing(true);
    const outcome = await shareSouvenir(photo.blob);
    if (outcome !== 'cancelled') setHandedOver(outcome);
    setSharing(false);
  };

  if (failed) {
    return (
      <div className={styles.review} role="alertdialog" aria-label="사진을 찍지 못했어요" data-testid="photo-failed">
        <div className={styles.side}>
          <h2 className={`${ui.display} ${styles.heading}`}>사진을 찍지 못했어요</h2>
          <p className={styles.text}>카메라 화면을 확인하고 다시 찍어 주세요.</p>
          <div className={styles.actions}>
            <button type="button" className={ui.primary} onClick={retake}>
              다시 찍기
            </button>
            <button type="button" className={ui.ghost} onClick={onDone}>
              건너뛰기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!photo) {
    return (
      <div className={styles.shoot} data-testid="photo-countdown">
        <p className={styles.pose}>내가 빚은 도자기 옆에서 포즈를 잡아 주세요</p>
        {count > 0 ? (
          <p key={count} className={styles.count} aria-live="assertive">
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
      <img className={styles.print} src={photo.url} alt="방금 찍은 사진: 내가 빚은 도자기와 함께" data-testid="photo-print" />
      <div className={styles.side}>
        <h2 className={`${ui.display} ${styles.heading}`}>사진이 나왔어요</h2>
        <p className={styles.text} data-testid="photo-note">
          {handedOver === 'shared'
            ? '사진을 보냈어요.'
            : handedOver === 'saved'
              ? '사진을 이 기기에 저장했어요.'
              : '사진은 이 화면에만 있고, 다음 화면으로 넘어가면 지워져요.'}
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
        <p className={styles.timer} data-testid="photo-timer">
          {sharing ? '공유가 끝나면 이어서 진행해요' : `${secondsLeft}초 뒤 자동으로 넘어가요`}
        </p>
        <a className={styles.home} href={ROUTES.home} data-testid="photo-home">
          처음으로
        </a>
      </div>
    </div>
  );
}
