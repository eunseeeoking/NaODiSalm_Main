/**
 * jsonplaceholder.typicode.com 클라이언트.
 * - 외부 API 호출은 라우트에서 직접 fetch 하지 않고, 이런 service 함수로 추상화한다.
 * - 장점: 재사용·테스트(모킹)·에러 정규화·헤더/키 관리가 한 곳에 모인다.
 */

const BASE_URL = 'https://jsonplaceholder.typicode.com';

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export class UpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export async function getPost(id: number | string): Promise<Post> {
  const res = await fetch(`${BASE_URL}/posts/${id}`);
  if (!res.ok) {
    throw new UpstreamError(res.status, `jsonplaceholder /posts/${id} failed`);
  }
  return (await res.json()) as Post;
}
