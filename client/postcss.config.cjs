/**
 * PostCSS 설정
 *  - tailwindcss: 유틸 클래스 생성
 *  - autoprefixer: 브라우저 prefix 자동 추가
 *
 * package.json 이 "type": "module" 이므로
 * 확장자 .cjs 로 두어 CommonJS 로드 — 호환성 100%.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
