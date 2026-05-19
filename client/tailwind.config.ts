import type { Config } from 'tailwindcss';

/**
 * Tailwind 설정 (토스 한국형 톤)
 *
 *  ⚠️ darkMode = 'class'
 *      → useThemeStore + App.tsx 가 <html class="dark"> 토글
 *
 *  ⚠️ corePlugins.preflight = false
 *      → 기존 CSS Modules / index.css 와 공존
 *
 *  ⚠️ 액센트 = 토스 블루 #3182F6 (메인) + 그린 #15B970 (수익률)
 *  ⚠️ 폰트   = Pretendard Variable (한글 가독성 최우선)
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // ── Surface (배경 계층) ──────────────────────────────
        //   라이트: 부드러운 회색 페이지 + 화이트 카드
        //   다크:  거의 검정 페이지 + 살짝 밝은 카드
        surface: {
          DEFAULT: '#F5F6F8',                  // light 페이지 배경
          elevated: '#FFFFFF',                  // light 카드
          'elevated-hover': '#FAFBFC',          // light 카드 호버
          dark: '#17171C',                      // dark 페이지 배경
          'dark-elevated': '#1E1E24',           // dark 카드
          'dark-elevated-hover': '#26262E',     // dark 카드 호버
        },
        // ── Brand (토스 블루) ────────────────────────────────
        brand: {
          50: '#EBF4FF',
          100: '#D2E4FF',
          200: '#A4C7FF',
          300: '#76A9FF',
          400: '#5B9BFF',
          500: '#3182F6',                       // ★ 메인
          600: '#1B64DA',
          700: '#1A56C2',
          800: '#0D47A1',
          900: '#0A3D8F',
          DEFAULT: '#3182F6',
        },
        // ── Positive (긍정 · 수익률 · 그린) ───────────────────
        positive: {
          50: '#E6F9F1',
          100: '#C7F0DC',
          400: '#3DCB87',
          500: '#15B970',                       // ★ 수익률 메인
          600: '#10A55E',
          DEFAULT: '#15B970',
        },
        // ── Negative (경고 · 부정) ──────────────────────────
        negative: {
          50: '#FEEEEE',
          100: '#FEE6E6',
          500: '#F04452',
          DEFAULT: '#F04452',
        },
        // ── 통근 히트맵 (토스 블루 ramp 5단계) ────────────────
        commute: {
          fastest: '#3182F6',                   // ≤20분 (가장 진함)
          fast: '#5B9BFF',                      // 20~30분
          medium: '#85B7FF',                    // 30~45분
          slow: '#B5D4FF',                      // 45~60분
          slowest: '#E1EEFF',                   // 60+분 (가장 옅음)
        },
        // ── 텍스트 톤 (4단계 × 라이트/다크) ───────────────────
        ink: {
          primary: '#191F28',                   // light 본문
          secondary: '#4E5968',
          tertiary: '#8B95A1',
          'primary-dark': '#F7F8F9',            // dark 본문
          'secondary-dark': '#B0B8C1',
          'tertiary-dark': '#6B7684',
        },
        // ── 보더 ────────────────────────────────────────────
        line: {
          light: '#E5E8EB',
          dark: '#2D2F36',
        },
        // ── 직장 마커 (액센트와 대비되는 코랄) ─────────────────
        workplace: '#F04452',
      },
      fontFamily: {
        // Pretendard 단독 (한글 가독성 최우선, 영문도 잘 받음)
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        // 모노 폰트도 Pretendard 로 폴백 — tabular-nums 클래스가 정렬 보장
        mono: [
          'Pretendard Variable',
          'Pretendard',
          'system-ui',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4' }],
        'metric-xl': ['32px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'metric-lg': ['20px', { lineHeight: '1.2', fontWeight: '600' }],
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.02em',
        tight: '-0.01em',
      },
      borderRadius: {
        card: '12px',
        cardlg: '16px',
        cardxl: '20px',
      },
      boxShadow: {
        // 토스 톤 — 부드러운 그림자, 호버 시 lift
        card: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        'card-hover': '0 6px 16px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'card-active': '0 0 0 3px rgba(49, 130, 246, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
