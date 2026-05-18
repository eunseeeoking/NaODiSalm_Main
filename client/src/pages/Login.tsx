import { FormEvent, useState } from 'react';
import { login, AuthUser } from '../api/auth';
import { ApiError } from '../api/client';
import s from '../css/Login.module.css';

interface LoginProps {
  onSuccess: (user: AuthUser) => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password, rememberMe);
      onSuccess(user);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 423) {
          setError('계정이 잠겼습니다. 관리자에게 문의하세요.');
        } else if (err.status === 401) {
          setError('이메일 또는 비밀번호가 일치하지 않습니다.');
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={s.form} onSubmit={onSubmit}>
      <h2 className={s.title}>로그인</h2>

      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor="email">이메일</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={s.fieldInput}
        />
      </div>

      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={s.fieldInput}
        />
      </div>

      <label className={s.checkbox}>
        <input
          type="checkbox"
          className={s.checkboxInput}
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        <span>로그인 유지 (체크 시 14일, 미체크 시 1일)</span>
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" className={s.submitButton} disabled={loading}>
        {loading ? '로그인 중...' : '로그인'}
      </button>

      <small className={s.testInfo}>
        테스트 가입: <code>POST /api/auth/signup</code>{' '}
        <code>{'{"email":"a@b.com","password":"1234"}'}</code>
      </small>
    </form>
  );
}
