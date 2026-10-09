// The photo a visitor takes with the pot they made: the camera picture as the panel shows it, the
// wheel and the pot, the visitor's own hands in front of the pot, and a caption, as one image.
// The picture is made on the device and handed to the visitor; it is never uploaded or kept.

/** The part of the camera frame that a panel of the given shape shows with object-fit: cover. */
export function cameraCrop(video: HTMLVideoElement, aspect: number): { x: number; y: number; width: number; height: number } {
  let width = video.videoWidth;
  let height = video.videoHeight;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  return { x: (video.videoWidth - width) / 2, y: (video.videoHeight - height) / 2, width, height };
}

export interface SouvenirCaption {
  title: string;
  /** Where and what, for example the museum and the experience. */
  place: string;
  /** The result line of the take, or null to leave it out. */
  scores: string | null;
  brand: string;
}

export interface SouvenirSource {
  /** The raw, un-mirrored camera picture. */
  video: HTMLVideoElement;
  /** Draws the wheel and the pot as they are right now into the given box; null if the wheel is not shown. */
  drawWheel: ((context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => void) | null;
  /** The layer that shows the visitor's hands in front of the pot (already mirrored). */
  hands: HTMLCanvasElement;
  /** width / height of the camera panel. */
  aspect: number;
  caption: SouvenirCaption;
}

const CARD_WIDTH = 1620;
const MARGIN = 60;
const PHOTO_WIDTH = CARD_WIDTH - 2 * MARGIN;
const CAPTION_HEIGHT = 250;
const PAPER = '#f4eee2';
const INK = '#1c1a17';
const DISPLAY_FONT = '"Shilla Culture M", "Nanum Myeongjo", AppleMyungjo, Batang, serif';
const TEXT_FONT = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';

/** Lays the photo out as a card with a caption and returns it as a JPEG. */
export async function composeSouvenir(source: SouvenirSource): Promise<Blob> {
  const { video, caption } = source;
  const photoHeight = Math.round(PHOTO_WIDTH / source.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = MARGIN + photoHeight + CAPTION_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas');

  // Canvas text falls back silently, so the caption's faces are asked for first.
  await Promise.allSettled([document.fonts.load(`500 78px ${DISPLAY_FONT}`), document.fonts.load(`500 34px ${TEXT_FONT}`)]);

  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // The picture: the same mirrored centre crop as the panel, then the pot, then the hands.
  context.save();
  context.beginPath();
  context.roundRect(MARGIN, MARGIN, PHOTO_WIDTH, photoHeight, 28);
  context.clip();
  if (video.videoWidth > 0) {
    const crop = cameraCrop(video, source.aspect);
    context.save();
    context.translate(MARGIN + PHOTO_WIDTH, MARGIN);
    context.scale(-1, 1);
    context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, PHOTO_WIDTH, photoHeight);
    context.restore();
  } else {
    // No camera picture (the scripted coach): the panel's own grey, so the pot still has a ground.
    context.fillStyle = '#d9d9d9';
    context.fillRect(MARGIN, MARGIN, PHOTO_WIDTH, photoHeight);
  }
  source.drawWheel?.(context, MARGIN, MARGIN, PHOTO_WIDTH, photoHeight);
  context.drawImage(source.hands, MARGIN, MARGIN, PHOTO_WIDTH, photoHeight);
  context.restore();

  // The caption: what and where on the left, the brand and the result on the right.
  const top = MARGIN + photoHeight;
  context.textBaseline = 'alphabetic';
  context.fillStyle = INK;
  context.font = `500 78px ${DISPLAY_FONT}`;
  context.fillText(caption.title, MARGIN, top + 112);
  context.font = `500 34px ${TEXT_FONT}`;
  context.fillStyle = '#5d564b';
  context.fillText(`${caption.place} · ${today()}`, MARGIN, top + 178);

  context.textAlign = 'right';
  context.fillStyle = '#8a7648';
  context.font = `500 66px ${DISPLAY_FONT}`;
  context.fillText(caption.brand, CARD_WIDTH - MARGIN, top + 108);
  if (caption.scores) {
    context.fillStyle = '#5d564b';
    context.font = `600 32px ${TEXT_FONT}`;
    context.fillText(caption.scores, CARD_WIDTH - MARGIN, top + 178);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the photo could not be encoded'))), 'image/jpeg', 0.92);
  });
}

function today(): string {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
}

function photoFile(photo: Blob): File {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return new File([photo], `ieum-${stamp}.jpg`, { type: 'image/jpeg' });
}

/** True where the device can hand a picture to another app (a phone or a tablet, mostly). */
export function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([], 'photo.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** Opens the device's share sheet with the photo, or saves it as a file where there is none. */
export async function shareSouvenir(photo: Blob): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = photoFile(photo);
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: '내가 빚은 도자기' });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      console.warn('Photo: sharing failed, saving the file instead', error);
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
