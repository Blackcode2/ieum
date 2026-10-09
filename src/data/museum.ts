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
//
// The museum has not seen or agreed to these screens, and since October 2026 they no longer say so
// (the team's decision): its consent is needed before visitors can reach them under its name.
export const MUSEUM = {
  name: '국립경주박물관',
  englishName: 'Gyeongju National Museum',
  hero: {
    src: 'assets/museum/hero.jpg',
    alt: '',
    credit:
      '박물관 사진: Christophe95 / Wikimedia Commons, CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0), 잘라 내고 일부 가림',
  } satisfies Photo,
  /** Shown with the photo credits. */
  fontCredit: '글꼴: 신라문화체(경주시)',
};

export const ARTWORK = {
  title: '토우장식 장경호',
  /** Short labels above the title. */
  labels: ['국보', '신라 5세기'],
  description:
    '목과 어깨에 흙으로 빚은 작은 인형 ‘토우’가 붙어 있는, 목이 긴 항아리예요. 개구리를 문 뱀, 새, 거북, 물고기, 현악기를 타는 사람 같은 토우에는 풍요를 비는 신라 사람들의 마음이 담겨 있어요.',
  facts: ['높이 34cm', '경주 계림로 30호 무덤에서 나왔어요'],
  photo: {
    src: 'assets/museum/artwork.jpg',
    alt: '목과 어깨에 작은 흙 인형들이 붙어 있고 입 둘레 일부가 깨진, 목이 긴 항아리',
    credit: '작품 사진: 국가유산청 국가유산포털(www.heritage.go.kr), 공공누리 제1유형',
  } satisfies Photo,
};

export const EXPERIENCE = {
  /** The first screen's headline, one entry per line. */
  headline: ['장인의 손길을', '내 손으로 따라 빚다'],
  lead: '오늘날의 도예 장인이 물레로 그릇을 빚는 손동작을 따라 해 보는 체험이에요.',
  /** The exercise stands next to the artwork, so the screen says what it is not. */
  disclaimer: '이 항아리를 만든 방법을 그대로 보여 주는 것은 아니에요.',
  /** What happens in the experience, shown on the first screen. */
  steps: ['양손을 화면에 보여 주세요', '장인의 손을 따라 흙을 끌어올려 보세요', '내가 빚은 도자기와 사진을 찍어 보세요'],
  start: '장인 따라서 체험하기',
  /** What the camera is used for, said before it is switched on. */
  note: '카메라는 손동작을 읽고 기념사진을 찍는 데만 써요. 영상은 녹화하지 않아요.',
  /** Header of the experience screen. */
  title: '장인 따라 빚기',
  guide: '김소명 장인의 손을 따라 흙을 끌어올려 보세요',
  /**
   * Caption of the photo a visitor takes with their pot. The photo leaves the kiosk, so it does not
   * carry the museum's name until the museum has agreed to that.
   */
  photoTitle: '내가 빚은 도자기',
  photoPlace: '장인 따라 빚기 체험',
};

// Everything about the master and the class is a stand-in. The name, the class title and the
// lesson list come from the lesson design; the field and the introductions were written for these
// screens. None of it is confirmed by a real master, and the clip is not known to show this
// person, so all of it has to be replaced or approved before the screens are shown as fact.
export const ARTISAN = {
  eyebrow: '화면 속 손의 주인공',
  name: '김소명 장인',
  field: '도예 · 물레 성형',
  /** The first screen says in one line whose hands the visitor is about to follow. */
  homeEyebrow: '함께하는 장인',
  brief: '물레 앞에서 흙을 다뤄 온 도예 장인이에요.',
  intro:
    '물레 앞에서 흙을 다뤄 온 도예 장인이에요. 영상만으로는 전해지지 않던 손의 높이와 속도를, 이음에서는 한 동작씩 겹쳐 보며 배울 수 있어요.',
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
