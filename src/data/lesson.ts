// Copy for the lesson screen, as written in the Figma frames "Desktop - 2 - good" / "Desktop - 3 - bad".

export interface CurriculumItem {
  title: string;
  duration: string;
}

export const LESSON = {
  title: '4강. 바닥이 뚫리지 않게 엄지로 구멍 내기',
  course: '김소명에게 직접 배우는 도자의 기초',
  videoUrl: 'lesson/lesson.mp4',
  referenceUrl: 'lesson/reference.json',
} as const;

export const CURRICULUM: ReadonlyArray<CurriculumItem> = [
  { title: '1강. 영상만 봐서는 안 되는 이유, 장인의 손 감각 따라하기', duration: '09:48' },
  { title: '2강. 흙이 자꾸 터진다면, 반죽부터 다시', duration: '10:32' },
  { title: '3강. 물레 위에서 흔들리는 흙의 중심 잡기', duration: '07:05' },
  { title: '4강. 바닥이 뚫리지 않게 엄지로 구멍 내기', duration: '10:32' },
  { title: '5강. 무너지는 기벽, 양손으로 끌어올리기', duration: '11:30' },
  { title: '6강. 사발과 항아리, 내가 원하는 곡선 만들기', duration: '10:32' },
  { title: '7강. 손끝에서 갈리는 완성도, 입술 다듬기', duration: '06:48' },
  { title: '8강. 뒤집어야 완성되는 그릇, 굽 깎기', duration: '12:02' },
];
