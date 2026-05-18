import { useState } from 'react';
import type { AuthUser } from '../api/auth';
import { Login } from '../pages/Login';

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
      <aside className="sidebar" role="navigation">
        <header className="sidebar-header">
          <h1>스마트 직세권</h1>
          <p>K-MaaS 기반 주거선택</p>
        </header>

        <div className="sidebar-section">
          <label className="field-label">지역 선택</label>
          <select
            className="sigungu-select"
            value={sigunguCode}
            onChange={(e) => onSigunguChange(e.target.value)}
          >
            {SEOUL_SIGUNGU.map((s) => (
              <option key={s.code} value={s.code}>
                서울 {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sidebar-search">
          <input type="search" placeholder="단지명 검색 (준비 중)" disabled />
        </div>

        <nav className="sidebar-nav">
          <button type="button" className="nav-item">📊 가성비 분석</button>
          <button type="button" className="nav-item">📈 투자 수익 (AI)</button>
          <button type="button" className="nav-item">🚗 통근 시뮬레이션</button>
          <button type="button" className="nav-item">⭐ 즐겨찾기</button>
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <div className="user-block">
              <div className="user-info">
                <div className="user-name">{user.name ?? user.email}</div>
                <div className="user-email">{user.email}</div>
              </div>
              <button type="button" onClick={onLogout}>로그아웃</button>
            </div>
          ) : (
            <button
              type="button"
              className="login-btn"
              onClick={() => setShowLogin(true)}
            >
              로그인
            </button>
          )}
        </div>
      </aside>

      {showLogin && !user && (
        <div
          className="modal-backdrop"
          onClick={() => setShowLogin(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <Login
              onSuccess={(u) => {
                onLogin(u);
                setShowLogin(false);
              }}
            />
            <button
              type="button"
              className="modal-close"
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
