import { useState } from 'react';
import type { AuthUser } from '../api/auth';
import { Login } from '../pages/Login';
import s from '../css/Sidebar.module.css';

interface SidebarProps {
  user: AuthUser | null;
  onLogin: (user: AuthUser) => void;
  onLogout: () => void;
  sigunguCode: string;
  onSigunguChange: (code: string) => void;
}

const SEOUL_SIGUNGU: ReadonlyArray<{ code: string; name: string }> = [
  { code: '11680', name: '강남구' },
  { code: '11740', name: '강동구' },
  { code: '11305', name: '강북구' },
  { code: '11500', name: '강서구' },
  { code: '11620', name: '관악구' },
  { code: '11215', name: '광진구' },
  { code: '11530', name: '구로구' },
  { code: '11545', name: '금천구' },
  { code: '11350', name: '노원구' },
  { code: '11320', name: '도봉구' },
  { code: '11230', name: '동대문구' },
  { code: '11590', name: '동작구' },
  { code: '11440', name: '마포구' },
  { code: '11410', name: '서대문구' },
  { code: '11650', name: '서초구' },
  { code: '11200', name: '성동구' },
  { code: '11290', name: '성북구' },
  { code: '11710', name: '송파구' },
  { code: '11470', name: '양천구' },
  { code: '11560', name: '영등포구' },
  { code: '11170', name: '용산구' },
  { code: '11380', name: '은평구' },
  { code: '11110', name: '종로구' },
  { code: '11140', name: '중구' },
  { code: '11260', name: '중랑구' },
];

export function Sidebar({
  user,
  onLogin,
  onLogout,
  sigunguCode,
  onSigunguChange,
}: SidebarProps) {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <aside className={s.sidebar} role="navigation">
        <header className={s.header}>
          <h1 className={s.headerTitle}>나어디삶</h1>
          <p className={s.headerSubtitle}>직장인을 위한 AI 주거 추천</p>
        </header>

        <div className={s.section}>
          <label className={s.fieldLabel}>지역 선택</label>
          <select
            className={s.sigunguSelect}
            value={sigunguCode}
            onChange={(e) => onSigunguChange(e.target.value)}
          >
            {SEOUL_SIGUNGU.map((it) => (
              <option key={it.code} value={it.code}>
                서울 {it.name}
              </option>
            ))}
          </select>
        </div>

        <div className={s.search}>
          <input
            type="search"
            className={s.searchInput}
            placeholder="단지명 검색 (준비 중)"
            disabled
          />
        </div>

        <nav className={s.nav}>
          <button type="button" className={s.navItem}>📊 가성비 분석</button>
          <button type="button" className={s.navItem}>📈 가격 분석</button>
          <button type="button" className={s.navItem}>🚗 통근 시뮬레이션</button>
          <button type="button" className={s.navItem}>⭐ 즐겨찾기</button>
        </nav>

        <div className={s.footer}>
          {user ? (
            <div className={s.userBlock}>
              <div className={s.userInfo}>
                <div className={s.userName}>{user.name ?? user.email}</div>
                <div className={s.userEmail}>{user.email}</div>
              </div>
              <button type="button" className={s.logoutBtn} onClick={onLogout}>
                로그아웃
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={s.loginBtn}
              onClick={() => setShowLogin(true)}
            >
              로그인
            </button>
          )}
        </div>
      </aside>

      {showLogin && !user && (
        <div
          className={s.modalBackdrop}
          onClick={() => setShowLogin(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className={s.modalBody} onClick={(e) => e.stopPropagation()}>
            <Login
              onSuccess={(u) => {
                onLogin(u);
                setShowLogin(false);
              }}
            />
            <button
              type="button"
              className={s.modalClose}
              onClick={() => setShowLogin(false)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
