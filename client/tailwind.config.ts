import type { Config } from 'tailwindcss';

/**
 * Tailwind 설정
 *
 *  ⚠️ corePlugins.preflight = false
 *      → 기존 index.css 의 글로벌 리셋/컴포넌트 스타일과 충돌 방지.
 *        새 Depth 2 컴포넌트는 Tailwind 유틸 클래스 사용,
 *        기존 컴포넌트(KakaoMap/Sidebar/Login)는 기존 CSS 그대로 동작.
 *
 *  ⚠️ content
 *      → tsx/ts 안에서 사용되는 클래스만 트리쉐이킹
 *
 *  ⚠️ extend.colors
 *      → 시안 v1 에서 사용한 색상 토큰 (통근 히트맵 5단계, 수익률 4단계 등)
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1a73e8',
          dark: '#1557b0',
        },
        // 통근 인내심 히트맵 5단계 (진할수록 가까움)
        commute: {
          fastest: '#04342C', // ≤20분
          fast: '#0F6E56',    // 20~30분
          medium: '#1D9E75',  // 30~45분
          slow: '#5DCAA5',    // 45~60분
          slowest: '#E1F5EE', // 60+분
        },
        // 수익률 4단계 (진할수록 높음)
        roi: {
          high: '#185FA5',
          midhigh: '#378ADD',
          mid: '#85B7EB',
          low: '#B5D4F4',
        },
        // UI 상태 (정보/경고/성공 등 시안에서 사용)
        info: {
          bg: '#E6F1FB',
          fg: '#0C447C',
          border: '#378ADD',
        },
        success: {
          bg: '#EAF3DE',
          fg: '#27500A',
        },
        warn: {
          bg: '#FAEEDA',
          fg: '#854F0B',
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // 시안 v1 의 폰트 크기 토큰
        'metric-lg': ['22px', { lineHeight: '1.2', fontWeight: '500' }],
        'metric-md': ['16px', { lineHeight: '1.2', fontWeight: '500' }],
        'label-xs': ['11px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        card: '8px',
        cardlg: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
