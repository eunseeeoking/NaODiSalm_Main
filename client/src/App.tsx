import { useEffect, useState } from 'react';
import { fetchMe, logout, AuthUser } from './api/auth';
import { KakaoMap } from './components/KakaoMap';
import { Sidebar } from './components/Sidebar';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => {
        /* 비로그인 상태 — Sidebar 가 로그인 버튼 노출 */
      })
      .finally(() => setBootChecked(true));
  }, []);

  async function onLogout() {
    await logout();
    setUser(null);
  }

  if (!bootChecked) {
    return (
      <div className="app-loading">
        <p>세션 확인 중...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar user={user} onLogin={setUser} onLogout={onLogout} />
      <main className="map-area">
        <KakaoMap />
      </main>
    </div>
  );
}
