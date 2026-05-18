/**
 * 기존 메인 화면 (시군구 선택 → 단지 마커 → 클릭 시 상세 카드)
 *  - 원래 App.tsx 의 내용을 그대로 옮긴 페이지
 *  - 새 메인은 RecommendationPage(/) — Depth 2 지역 추천
 *  - 이 페이지는 /explore 로 보존 (원시 데이터 탐색용)
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMe, logout, AuthUser } from '../api/auth';
import { fetchComplexes, type ComplexMarker } from '../api/realty';
import { KakaoMap } from '../components/KakaoMap';
import { Sidebar } from '../components/Sidebar';
import { ComplexDetailCard } from '../components/ComplexDetailCard';
import s from '../css/Explore.module.css';

export function ExplorePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);
  const [markers, setMarkers] = useState<ComplexMarker[]>([]);
  const [selected, setSelected] = useState<ComplexMarker | null>(null);
  const [sigunguCode, setSigunguCode] = useState<string>('11680'); // 강남구 기본

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => {})
      .finally(() => setBootChecked(true));
  }, []);

  // 시군구 변경 시 마커 다시 로드
  useEffect(() => {
    fetchComplexes({ sigunguCode })
      .then(setMarkers)
      .catch((e) => {
        console.error('[markers]', e);
        setMarkers([]);
      });
  }, [sigunguCode]);

  async function onLogout() {
    await logout();
    setUser(null);
  }

  if (!bootChecked) {
    return (
      <div className={s.loading}>
        <p>세션 확인 중...</p>
      </div>
    );
  }

  return (
    <div className={s.layout}>
      <Sidebar
        user={user}
        onLogin={setUser}
        onLogout={onLogout}
        sigunguCode={sigunguCode}
        onSigunguChange={setSigunguCode}
      />
      <main className={s.mapArea}>
        <Link to="/" className={s.backLink}>
          ← 지역 추천으로
        </Link>
        <KakaoMap markers={markers} onMarkerClick={setSelected} />
        {selected && (
          <ComplexDetailCard
            marker={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </main>
    </div>
  );
}
