import { FormEvent, useState } from 'react';
import { login, AuthUser } from '../api/auth';
import { ApiError } from '../api/client';

/**
 * 로그인 페이지.
 *  - 성공 시: 서버가 응답한 계정 정보(SafeUser)를 화면에 표시
 *  - 실패 시: HTTP 401 → 메시지 출력
 *  - 세션 저장은 하지 않는다 (간단 구현). 새로고침하면 다시 로그인 폼.
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const u = await login(email, password);
      setUser(u);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('이메일 또는 비밀번호가 일치하지 않습니다.');
      } else {
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      }
    } finally {
      setLoading(false);
    }
  }

  if (user) {
    return (
      <section className="card">
        <h2>로그인 성공</h2>
        <dl className="kv">
          <dt>id</dt><dd>{user.id}</dd>
          <dt>email</dt><dd>{user.email}</dd>
          <dt>name</dt><dd>{user.name ?? '-'}</dd>
          <dt>phone</dt><dd>{user.phone ?? '-'}</dd>
          <dt>로그인 실패 횟수</dt><dd>{user.loginFailCount}</dd>
          <dt>가입일</dt><dd>{new Date(user.createdAt).toLocaleString()}</dd>
        </dl>
        <button type="button" onClick={() => { setUser(null); setEmail(''); setPassword(''); }}>
          로그아웃
        </button>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>로그인</h2>

      <div className="field">
        <label htmlFor="email">이메일</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={loading}>
        {loading ? '로그인 중...' : '로그인'}
      </button>

      <small>
        테스트용 가입: <code>POST /api/auth/signup</code> body{' '}
        <code>{'{"email":"a@b.com","password":"1234"}'}</code>
      </small>
    </form>
  );
}
