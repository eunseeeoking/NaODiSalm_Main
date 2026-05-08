import { useEffect, useState } from 'react';
import { getHello } from './api/greeting';
import { Login } from './pages/Login';
import { fetchMe, logout, AuthUser } from './api/auth';
import { tokenStorage } from './api/tokenStorage';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);
  const [helloMsg, setHelloMsg] = useState<string>('로딩 중...');
  const [helloErr, setHelloErr] = useState<string | null>(null);

  // 부트: 저장된 토큰이 있으면 /me 로 자동 로그인 시도
  useEffect(() => {
    if (!tokenStorage.getAccess() && !tokenStorage.getRefresh()) {
      setBootChecked(true);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch(() => {
        tokenStorage.clear();
      })
      .finally(() => setBootChecked(true));
  }, []);

  // greeting 테스트 (DB/인증 무관, 항상 호출)
  useEffect(() => {
    getHello('test')
      .then((d) => setHelloMsg(d.message))
      .catch((e: Error) => setHelloErr(e.message));
  }, []);

  async function onLogout() {
    await logout();
    setUser(null);
  }

  if (!bootChecked) {
    return (
      <main className="container">
        <p>세션 확인 중...</p>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>2026 MOLIT Contest</h1>
      <p>Vite + React + TypeScript &amp; Express 모노레포 스타터</p>

      {user ? (
        <section className="card">
          <h2>로그인 상태</h2>
          <dl className="kv">
            <dt>id</dt><dd>{user.id}</dd>
            <dt>email</dt><dd>{user.email}</dd>
            <dt>name</dt><dd>{user.name ?? '-'}</dd>
            <dt>phone</dt><dd>{user.phone ?? '-'}</dd>
            <dt>로그인 실패 횟수</dt><dd>{user.loginFailCount}</dd>
            <dt>가입일</dt><dd>{new Date(user.createdAt).toLocaleString()}</dd>
          </dl>
          <button type="button" onClick={onLogout}>로그아웃</button>
          <small>새로고침해도 토큰이 유효한 동안 자동 로그인됩니다.</small>
        </section>
      ) : (
        <Login onSuccess={setUser} />
      )}

      <section className="card">
        <h2>서버 통신 테스트 (public)</h2>
        {helloErr ? (
          <p className="error">에러: {helloErr}</p>
        ) : (
          <p className="ok">서버 응답: {helloMsg}</p>
        )}
        <small>호출: getHello('test') → GET /api/greeting/hello?name=test</small>
      </section>
    </main>
  );
}
