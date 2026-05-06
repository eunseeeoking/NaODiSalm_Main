import { useEffect, useState } from 'react';
import { getHello } from './api/greeting';

export default function App() {
  const [message, setMessage] = useState<string>('로딩 중...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHello('은석')
      .then((data) => setMessage(data.message))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="container">
      <h1>2026 MOLIT Contest</h1>
      <p>Vite + React + TypeScript &amp; Express 모노레포 스타터</p>

      <section className="card">
        <h2>서버 통신 테스트</h2>
        {error ? (
          <p className="error">에러: {error}</p>
        ) : (
          <p className="ok">서버 응답: {message}</p>
        )}
        <small>호출: getHello('은석') → GET /api/greeting/hello?name=은석</small>
      </section>
    </main>
  );
}
