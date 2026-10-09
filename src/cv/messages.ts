import type { Feedback, FeedbackCode, FeedbackTone } from './types';

// Pill copy. 'steady' and 'too-fast' are the designer's wording; the rest follows the same voice.
const COPY: Record<FeedbackCode, { tone: FeedbackTone; message: string }> = {
  loading: { tone: 'neutral', message: '준비하고 있어요' },
  'load-failed': { tone: 'bad', message: '체험을 준비하지 못했어요. ‘처음으로’를 눌러 다시 시작해 주세요' },
  'camera-blocked': { tone: 'bad', message: '카메라를 쓸 수 없어요. 카메라 사용을 허용해 주세요' },
  'show-hands': { tone: 'neutral', message: '양손을 화면에 보여 주면 흙이 나타나요' },
  'press-play': { tone: 'neutral', message: '‘따라 하기 시작’을 누르고 장인을 따라 해 보세요' },
  countdown: { tone: 'neutral', message: '' },
  'hold-still': { tone: 'neutral', message: '양손을 흙 옆에서 잠깐 멈추면 시작해요' },
  follow: { tone: 'neutral', message: '장인의 손을 따라 올려 보세요' },
  steady: { tone: 'good', message: '흔들림없이 잘하고 있어요!' },
  'too-fast': { tone: 'bad', message: '올리는 속도가 빨라요!' },
  'hands-uneven': { tone: 'bad', message: '양손 높이가 달라요!' },
  'hands-apart': { tone: 'bad', message: '양손 간격이 벌어졌어요!' },
  'hands-close': { tone: 'bad', message: '양손 간격이 좁아졌어요!' },
  shaky: { tone: 'bad', message: '손이 흔들리고 있어요!' },
  'hands-lost': { tone: 'bad', message: '양손이 화면에 보이게 해 주세요' },
  'finish-up': { tone: 'neutral', message: '' },
  'result-good': { tone: 'good', message: '' },
  'result-bad': { tone: 'bad', message: '' },
  'no-movement': { tone: 'bad', message: '손이 움직이지 않았어요. 장인을 따라 손을 올려 보세요' },
  'not-tracked': { tone: 'bad', message: '손이 잘 보이지 않았어요' },
};

export function feedback(code: FeedbackCode, message?: string): Feedback {
  const entry = COPY[code];
  return { tone: entry.tone, code, message: message ?? entry.message };
}

export function countdownFeedback(secondsLeft: number): Feedback {
  return { ...feedback('countdown', `${secondsLeft}초 뒤 시작해요`), count: secondsLeft };
}

/** After the count, while the clip waits for the hands: what is missing, and how long it will wait. */
export function waitingFeedback(code: 'hold-still' | 'show-hands', secondsLeft: number): Feedback {
  return feedback(code, `${COPY[code].message} · ${secondsLeft}초`);
}

/** After the clip, for a learner who is still on the way up: there is time left, and how much. */
export function finishUpFeedback(secondsLeft: number): Feedback {
  return feedback('finish-up', `천천히 끝까지 올려 보세요 · ${secondsLeft}초`);
}

/** A finished pot has to reach this 모양 일치도 for the result to count as good. */
const GOOD_SHAPE = 60;

/**
 * The result line. With a pot on the wheel it carries both scores. They are not averaged: a good
 * result needs the movement to pass as before, and the pot not to have failed.
 */
export function resultFeedback(motion: number, shape: number | null, goodFrom: number): Feedback {
  const scores = shape === null ? `동작 일치 ${motion}%` : `동작 일치 ${motion}% · 모양 일치 ${shape}%`;
  const good = motion >= goodFrom && (shape === null || shape >= GOOD_SHAPE);
  return good
    ? feedback('result-good', `${scores} · 잘 따라 했어요!`)
    : feedback('result-bad', `${scores} · 다시 해 볼까요?`);
}
