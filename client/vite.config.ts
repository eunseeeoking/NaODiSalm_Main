import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // /api 로 시작하는 요청을 Express 서버(:4000)로 프록시
      // - changeOrigin: Host 헤더를 target 으로 변경
      // - cookieDomainRewrite: 서버가 내려준 쿠키 도메인을 클라이언트 호스트로 매핑
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
