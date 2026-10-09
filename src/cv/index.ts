import { LESSON } from '../data/lesson';
import { publicUrl } from '../publicUrl';
import { RealCoach } from './lessonCoach';
import { MockCoach } from './mockCoach';
import type { LessonCoach } from './types';

export type { ClayShape } from './clay';
export type { CoachState, Feedback, FeedbackTone, LessonCoach, LessonTime, OverlayHand, SessionResult } from './types';
export { HAND_CONNECTIONS } from './types';

function addressParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  // Also accept the query after the route: /#/lesson?mock=good
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').forEach((value, key) => params.set(key, value));
  return params;
}

/**
 * True when the address asks for a stand-in instead of the camera (see createCoach). The screen
 * says so, because these switches also work in a built site: a kiosk started from a test address
 * would otherwise run without a camera and nobody would notice.
 */
export function usesTestInput(): boolean {
  const params = addressParams();
  return params.has('mock') || params.has('camera');
}

/**
 * The lesson screen's coach.
 *   ?mock=good | ?mock=bad   a scripted coach that needs no camera, for checking both pill states
 *   ?camera=/path/take.mp4   follow a recording instead of the webcam, for tests
 */
export function createCoach(): LessonCoach {
  const params = addressParams();
  const mock = params.get('mock');
  if (mock === 'good' || mock === 'bad') return new MockCoach(mock);
  return new RealCoach({
    lessonUrl: publicUrl(LESSON.videoUrl),
    referenceUrl: publicUrl(LESSON.referenceUrl),
    wasmBase: publicUrl('mediapipe/wasm'),
    modelUrl: publicUrl('mediapipe/hand_landmarker.task'),
    cameraFileUrl: params.get('camera') ? publicUrl(params.get('camera')!) : null,
  });
}
