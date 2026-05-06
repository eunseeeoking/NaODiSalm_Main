import { apiFetch } from './client';

/**
 * /api/greeting 도메인 호출 함수.
 * - 서버의 routes/domains/greeting.ts 와 1:1 대응.
 * - 컴포넌트는 이 함수만 import 해서 쓰고, fetch URL/포맷은 알 필요 없다.
 */

export interface HelloResponse {
  message: string;
}

export interface EchoResponse<T = unknown> {
  youSent: T;
}

export function getHello(name?: string): Promise<HelloResponse> {
  return apiFetch<HelloResponse>('/api/greeting/hello', {
    query: { name },
  });
}

export function postEcho<T = unknown>(payload: T): Promise<EchoResponse<T>> {
  return apiFetch<EchoResponse<T>>('/api/greeting/echo', {
    method: 'POST',
    json: payload,
  });
}
