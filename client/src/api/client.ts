/**
 * 클라이언트 측 공용 fetch 래퍼.
 *  - credentials: 'include' — httpOnly 쿠키 자동 전송 (브라우저가 알아서 처리)
 *  - 401 응답 시 1회에 한해 /api/auth/refresh 시도 → 성공하면 원 요청 재시도
 *  - JS 에서는 토큰을 절대 만지지 않는다 (XSS 방어)
 */

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** 객체를 넘기면 자동으로 JSON.stringify + Content-Type 세팅 */
  json?: unknown;
  /** ?key=value 자동 직렬화 */
  query?: Record<string, string | number | boolean | undefined>;
  /** 내부용 — 재귀 방지 */
  _retried?: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = API_BASE + path;
  if (!query) return base;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

/* ─── refresh 코어 ─────────────────────────────────────────── */

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(API_BASE + '/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        return res.ok; // 204 또는 200 모두 truthy
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      }
    })();
  }
  return refreshing;
}

/* ─── 본 fetch ─────────────────────────────────────────────── */

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { json, query, headers, _retried, ...rest } = opts;

  const init: RequestInit = {
    credentials: 'include', // 모든 요청에 쿠키 자동 동봉
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  };

  const res = await fetch(buildUrl(path, query), init);

  // 401 → refresh 시도 (단, refresh/login/signup 은 자기 자신 재귀 방지)
  if (
    res.status === 401 &&
    !_retried &&
    !path.startsWith('/api/auth/refresh') &&
    !path.startsWith('/api/auth/login') &&
    !path.startsWith('/api/auth/signup')
  ) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...opts, _retried: true });
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      msg = data.error ?? data.message ?? msg;
    } catch {
      /* body 가 JSON 이 아닌 경우 무시 */
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
