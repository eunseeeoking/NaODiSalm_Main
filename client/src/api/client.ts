/**
 * 클라이언트 측 공용 fetch 래퍼.
 * - 모든 API 호출이 이 함수를 거치도록 한다 (도메인 함수에서 사용).
 * - 에러를 ApiError 로 정규화 → 화면에서 일관된 처리 가능.
 * - 추후 인증 헤더, 타임아웃, 재시도, 로깅을 여기 한 군데에 추가할 수 있다.
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
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { json, query, headers, ...rest } = opts;

  const init: RequestInit = {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  };

  const res = await fetch(buildUrl(path, query), init);
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

  // 204 No Content 같은 경우 대응
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
