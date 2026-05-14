import { useState } from 'react';
import type { AuthUser } from '../api/auth';
import { Login } from '../pages/Login';

interface SidebarProps {
  user: AuthUser | null;
  onLogin: (user: AuthUser) => void;
  onLogout: () => void;
}

/**
 * 네이버 지도 스타일의 좌측 패널 (320px 고정).
 *  - 상단: 로고/타이틀
 *  - 검색 입력
 *  - 카테고리 (placeholder — 추후 도메인별 기능)
 *  - 하단: 로그인/사용자
 */
export function Sidebar({ user, onLogin, onLogout }: SidebarProps) {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <aside className="sidebar" role="navigation">
        <header className="sidebar-header">
          <h1>MOLIT 2026</h1>
          <p>국토교통 공모전</p>
        </header>

        <div className="sidebar-search">
          <input type="search" placeholder="장소·주소 검색" />
        </div>

        <nav className="sidebar-nav">
          <button type="button" className="nav-item">🏥 의료시설</button>
          <button type="button" className="nav-item">🏫 교육시설</button>
          <button type="button" className="nav-item">🅿️ 주차장</button>
          <button type="button" className="nav-item">🚌 정류장</button>
          <button type="button" className="nav-item">📚 도서관</button>
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
