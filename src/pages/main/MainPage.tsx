import { ScaledCanvas } from '../../components/ScaledCanvas';
import styles from './MainPage.module.css';

/** Figma frame "Desktop - 1 - main" (node 7:2): 1920 x 2915 design pixels. */
const FRAME_HEIGHT = 2915;

/** Hash route of the lesson screen (ROUTES.lesson in src/App.tsx). */
const LESSON_HREF = '#/lesson';

/** Files in public/assets/main, downloaded from the Figma frame. */
const asset = (file: string) => `${import.meta.env.BASE_URL}assets/main/${file}`;

// Not wired to anything in this demo, so these render as plain text rather than dead links.
const NAV_ITEMS = ['서비스', '검색', '마이 클래스'] as const;
const FOOTER_LINKS = ['ABOUT', '이용약관', '개인정보처리방침', '이용안내', '고객센터'] as const;

interface BestClass {
  id: string;
  /** The design sets every title on exactly two lines. */
  titleLines: readonly [string, string];
  artisan: string;
  photo: string;
  photoAlt: string;
  /** How the photo sits in its 500 x 444 frame. */
  photoClassName: string;
}

// The copy is exactly the design's, placeholders included: card 2 repeats card 1's title, and
// cards 2 and 3 still say "타이틀" where the artisan's name goes.
const BEST_CLASSES: readonly BestClass[] = [
  {
    id: 'gat',
    titleLines: ['장인의 손끝에서 피어나는 멋: ', '정춘모와 함께하는 전통 갓 만들기'],
    artisan: '정춘모 장인',
    photo: asset('class-gat.png'),
    photoAlt: '작업실에서 갓의 둥근 양태를 들어 살펴보는 한복 차림의 장인',
    photoClassName: styles.photoCropGat,
  },
  {
    id: 'maedeup',
    titleLines: ['장인의 손끝에서 피어나는 멋: ', '정춘모와 함께하는 전통 갓 만들기'],
    artisan: '타이틀',
    photo: asset('class-maedeup.png'),
    photoAlt: '분홍색 끈으로 전통 매듭을 짓고 있는 두 손',
    photoClassName: styles.photoCover,
  },
  {
    id: 'bangpaeyeon',
    titleLines: ['황금비율에 담긴 바람의 지혜 - ', '배무삼 장인의 방패연'],
    artisan: '타이틀',
    photo: asset('class-bangpaeyeon.jpg'),
    photoAlt: '잔디밭 위에 놓인 알록달록한 방패연과 실을 감은 얼레',
    photoClassName: styles.photoCover,
  },
];

const COMPANY_LINES = [
  '주소 : 서울시 마포구 연남동 / 사업자등록번호: 611-07 / 통신판매업신고: 제 2026-서울영등포1234호',
  // The design has two spaces after "전화 :"; the block is white-space: pre-wrap to keep them.
  '대표 : 김장인 / 전화 :  010-1234-5678 / 비지니스관련문의 : jangin@naver.com',
] as const;

export function MainPage() {
  return (
    <ScaledCanvas height={FRAME_HEIGHT} background="#fff">
      <header className={styles.header}>
        <p className={styles.logo}>이음</p>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <ul className={styles.navList}>
            {NAV_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="main-hero-title">
          <div className={styles.heroPhoto}>
            <img src={asset('hero-pottery.png')} alt="" />
          </div>
          <div className={styles.heroShade}>
            <div className={styles.heroCopy}>
              <h1 id="main-hero-title" className={styles.heroTitle}>
                수십 년 경력 장인의 손기술,
                <br />
                이제 집에서 배우세요
              </h1>
              <p className={styles.heroLead}>
                이음은 대한민국 장인에게 직접 배우는
                <br />
                전통 공예 클래스를 제공하는 서비스입니다.
              </p>
            </div>
            <a className={styles.continueLink} href={LESSON_HREF}>
              <span className={styles.continueLabel}>
                이어서 보기
                <span aria-hidden="true">{'   →'}</span>
              </span>
            </a>
            <div className={styles.heroChevron} aria-hidden="true">
              <div className={styles.heroChevronBleed}>
                <img src={asset('hero-chevron-next.svg')} alt="" />
              </div>
            </div>
          </div>
          <div className={styles.heroDots} aria-hidden="true">
            <img src={asset('hero-pagination-dots.svg')} alt="" />
          </div>
        </section>

        <section className={styles.best} aria-labelledby="main-best-title">
          <div className={styles.bestHeader}>
            <h2 id="main-best-title" className={styles.bestTitle}>
              베스트 클래스
            </h2>
            <p className={styles.more}>더보기</p>
          </div>
          <ul className={styles.cardList}>
            {BEST_CLASSES.map((item) => (
              <li key={item.id} className={styles.card}>
                <div className={styles.cardPhoto}>
                  <img className={item.photoClassName} src={item.photo} alt={item.photoAlt} />
                </div>
                <h3 className={styles.cardTitle}>
                  {item.titleLines.map((line) => (
                    <span key={line} className={styles.cardTitleLine}>
                      {line}
                    </span>
                  ))}
                </h3>
                <p className={styles.cardArtisan}>{item.artisan}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className={styles.footer}>
        <ul className={styles.footerLinks}>
          {FOOTER_LINKS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <img className={styles.instagram} src={asset('icon-instagram.png')} alt="인스타그램" />
        <address className={styles.company}>
          {COMPANY_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </address>
        <p className={styles.copyright}>© ieum All rights reserved.</p>
      </footer>
    </ScaledCanvas>
  );
}
