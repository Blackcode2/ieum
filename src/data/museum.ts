// What the kiosk says: the museum, the artwork it stands next to, the experience, the master and
// their class. One kiosk belongs to one artwork, so another artwork means another copy of this file.
//
// The text about the artwork was checked against the national heritage portal, the museum's own
// object page and e뮤지엄 (October 2026). It deliberately does not say how the jar was formed or
// fired, give the mouth diameter or name the instrument: the sources are silent or disagree there.
// The experience is the master's craft, not a claim about how this jar was made.
import { CURRICULUM, LESSON, type CurriculumItem } from './lesson';

export interface Photo {
  /** Path under public/. */
  src: string;
  alt: string;
  /** Shown with the picture: who made it and under which licence. */
  credit: string;
}

// The two photos are stand-ins with open licences until the museum supplies its own; where they
// come from and what was changed is in public/assets/museum/CREDITS.md.
export const MUSEUM = {
  name: '국립경주박물관',
  englishName: 'Gyeongju National Museum',
  hero: {
    src: 'assets/museum/hero.jpg',
    alt: '',
    credit: '박물관 사진: Christophe95 / Wikimedia Commons, CC BY-SA 4.0 (잘라 내고 일부 가림)',
  } satisfies Photo,
};

export const ARTWORK = {
  title: '토우장식 장경호',
  /** Short labels above the title. */
  labels: ['국보', '신라 5세기'],
  description:
    '목과 어깨에 흙으로 빚은 작은 인형, ‘토우’가 붙어 있는 목이 긴 항아리입니다. 개구리를 문 뱀과 새, 거북, 물고기, 현악기를 타는 사람 등에 풍요를 비는 신라 사람들의 마음이 담겨 있습니다.',
  facts: ['높이 34cm', '경주 계림로 30호 무덤 출토'],
  photo: {
    src: 'assets/museum/artwork.jpg',
    alt: '목과 어깨에 작은 흙 인형들이 붙어 있고 입 둘레 일부가 깨진, 목이 긴 항아리',
    credit: '작품 사진: 국가유산청 국가유산포털(www.heritage.go.kr), 공공누리 제1유형',
  } satisfies Photo,
};

export const EXPERIENCE = {
  /** The first screen's headline, one entry per line. */
  headline: ['장인의 손길을', '내 손으로 따라 빚다'],
  lead: '화면 속 장인의 손을 따라 물레 위의 흙을 직접 끌어올려 보세요.',
  /** What happens in the experience, shown on the first screen. */
  steps: ['양손을 화면에 보여 주세요', '장인의 손을 따라 흙을 끌어올려요', '내가 빚은 도자기와 사진을 찍어요'],
  start: '장인 따라서 체험하기',
  note: '카메라는 손동작을 읽는 데만 쓰고, 영상은 저장하지 않아요',
  /** Header of the experience screen. */
  title: '장인 따라 빚기',
  guide: '김소명 장인의 손을 따라 흙을 끌어올려 보세요',
  /** Caption of the photo a visitor takes with their pot. */
  photoTitle: '내가 빚은 도자기',
  photoPlace: '국립경주박물관 · 장인 따라 빚기',
};

// The master's name and the class come from the lesson design. The introduction is placeholder
// text for the demo and has to be replaced with the master's own.
export const ARTISAN = {
  eyebrow: '방금 따라 한 손의 주인공',
  name: '김소명 장인',
  field: '도예 · 물레 성형',
  intro:
    '물레 앞에서 흙을 다뤄 온 도예 장인입니다. 영상만으로는 전해지지 않던 손의 높이와 속도를, 이음에서는 한 동작씩 겹쳐 보며 배울 수 있습니다.',
  clip: LESSON.videoUrl,
  clipLabel: '장인의 손',
};

export const CLASS: {
  label: string;
  title: string;
  format: string;
  lessons: ReadonlyArray<CurriculumItem>;
  /** Title of the lesson whose movement the kiosk lets a visitor try. */
  experienced: string;
  apply: string;
} = {
  label: '장인이 연 클래스',
  title: LESSON.course,
  format: '이음 온라인 클래스',
  lessons: CURRICULUM,
  experienced: '5강. 무너지는 기벽, 양손으로 끌어올리기',
  apply: '클래스 신청하러 가기',
};
