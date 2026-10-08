import type { Feedback, FeedbackCode, FeedbackTone } from './types';

// Pill copy. 'steady' and 'too-fast' are the designer's wording; the rest follows the same voice.
const COPY: Record<FeedbackCode, { tone: FeedbackTone; message: string }> = {
  loading: { tone: 'neutral', message: '준비하고 있어요' },
  'load-failed': { tone: 'bad', message: '준비하지 못했어요. 새로고침해 주세요' },
  'camera-blocked': { tone: 'bad', message: '카메라를 사용할 수 없어요' },
  'show-hands': { tone: 'neutral', message: '양손을 화면에 보여 주세요' },
  'press-play': { tone: 'neutral', message: '재생을 누르고 따라 해 보세요' },
  countdown: { tone: 'neutral', message: '' },
  follow: { tone: 'neutral', message: '장인의 손을 따라 올려 보세요' },
  steady: { tone: 'good', message: '흔들림없이 잘하고 있어요!' },
  'too-fast': { tone: 'bad', message: '올리는 속도가 빨라요!' },
  'too-slow': { tone: 'bad', message: '올리는 속도가 느려요!' },
  'hands-uneven': { tone: 'bad', message: '양손 높이가 달라요!' },
  'hands-apart': { tone: 'bad', message: '양손 간격이 벌어졌어요!' },
  'hands-close': { tone: 'bad', message: '양손 간격이 좁아졌어요!' },
  shaky: { tone: 'bad', message: '손이 흔들리고 있어요!' },
  'hands-lost': { tone: 'bad', message: '양손이 화면에 보이게 해 주세요' },
  'result-good': { tone: 'good', message: '' },
  'result-bad': { tone: 'bad', message: '' },
  'no-movement': { tone: 'bad', message: '움직임이 감지되지 않았어요' },
  'not-tracked': { tone: 'bad', message: '손이 잘 보이지 않았어요' },
};

export function feedback(code: FeedbackCode, message?: string): Feedback {
  const entry = COPY[code];
  return { tone: entry.tone, code, message: message ?? entry.message };
}

export function countdownFeedback(secondsLeft: number): Feedback {
  return feedback('countdown', `${secondsLeft}초 뒤 시작해요`);
}

export function resultFeedback(score: number, goodFrom: number): Feedback {
  return score >= goodFrom
    ? feedback('result-good', `동작 일치도 ${score}% · 잘 따라 했어요!`)
    : feedback('result-bad', `동작 일치도 ${score}% · 다시 해 볼까요?`);
}
