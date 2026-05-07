import type { Prisma, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';

/**
 * t_user 테이블에 대한 DB 질의 함수.
 *
 * 규약:
 * - 기본 조회는 deleted_at IS NULL 인 행만 반환 (소프트 삭제)
 * - 응답에서 password 는 제외하기 위해 SafeUser 타입을 사용한다
 */

const NOT_DELETED: Prisma.UserWhereInput = { deletedAt: null };

/** API 응답에서 password 를 제외한 사용자 타입 */
export type SafeUser = Omit<User, 'password'>;

const stripPassword = ({ password: _pw, ...rest }: User): SafeUser => rest;

// ─── 조회 ──────────────────────────────────────────────────────
export async function findAllUsers(): Promise<SafeUser[]> {
  const rows = await prisma.user.findMany({
    where: NOT_DELETED,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(stripPassword);
}

export async function findUserById(id: number): Promise<SafeUser | null> {
  const u = await prisma.user.findFirst({ where: { id, ...NOT_DELETED } });
  return u ? stripPassword(u) : null;
}

export async function findUserByEmail(email: string): Promise<SafeUser | null> {
  const u = await prisma.user.findFirst({ where: { email, ...NOT_DELETED } });
  return u ? stripPassword(u) : null;
}

// ─── 생성 / 수정 ───────────────────────────────────────────────
export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<SafeUser> {
  if (input.email.startsWith('del_')) {
    throw new Error("email cannot start with 'del_' (reserved marker)");
  }
  const hashed = await bcrypt.hash(input.password, 10);
  const created = await prisma.user.create({
    data: {
      email: input.email,
      password: hashed,
      name: input.name,
      phone: input.phone,
    },
  });
  return stripPassword(created);
}

export async function updateUser(
  id: number,
  patch: Prisma.UserUpdateInput,
): Promise<SafeUser> {
  // password 변경은 별도 함수(changePassword) 로만 허용 — 평문이 들어오는 것 차단
  if ('password' in patch) {
    throw new Error('use changePassword() to update password');
  }
  const u = await prisma.user.update({ where: { id }, data: patch });
  return stripPassword(u);
}

export async function changePassword(id: number, newPassword: string): Promise<SafeUser> {
  const hashed = await bcrypt.hash(newPassword, 10);
  const u = await prisma.user.update({ where: { id }, data: { password: hashed } });
  return stripPassword(u);
}

// ─── 삭제 ─────────────────────────────────────────────────────
/**
 * 소프트 삭제
 *  - deleted_at 에 현재 시각 기록
 *  - email 앞에 'del_' 마커를 붙여 유니크 제약을 풀어준다
 *  - 이미 삭제된 사용자는 그대로 반환 (멱등)
 */
export async function deleteUser(id: number): Promise<SafeUser> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (user.deletedAt) return stripPassword(user);

  const newEmail = user.email.startsWith('del_')
    ? user.email
    : `del_${user.email}`;

  const u = await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), email: newEmail },
  });
  return stripPassword(u);
}

export async function hardDeleteUser(id: number): Promise<SafeUser> {
  const u = await prisma.user.delete({ where: { id } });
  return stripPassword(u);
}

// ─── 로그인 ────────────────────────────────────────────────────
export type LoginResult =
  | { ok: true; user: SafeUser }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_PASSWORD' };

/**
 * 이메일/비밀번호 검증
 *  - 성공: login_fail_count 를 0 으로 리셋, 사용자 정보 반환
 *  - 실패(존재): login_fail_count +1
 *  - 실패(미존재): 사용자 열거 회피 위해 동일 응답 시간/형식 유지
 */
export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findFirst({ where: { email, ...NOT_DELETED } });
  if (!user) {
    // 타이밍 공격 회피: dummy compare 로 응답 시간을 비슷하게
    await bcrypt.compare(password, '$2a$10$invalidhashinvalidhashinvalidhashin');
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const matched = await bcrypt.compare(password, user.password);
  if (!matched) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginFailCount: { increment: 1 } },
    });
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { loginFailCount: 0 },
  });
  return { ok: true, user: stripPassword(updated) };
}

// ─── 로그인 카운터 직접 조작 (관리자/테스트용) ────────────────
export async function incrementLoginFailCount(id: number): Promise<SafeUser> {
  const u = await prisma.user.update({
    where: { id },
    data: { loginFailCount: { increment: 1 } },
  });
  return stripPassword(u);
}

export async function resetLoginFailCount(id: number): Promise<SafeUser> {
  const u = await prisma.user.update({
    where: { id },
    data: { loginFailCount: 0 },
  });
  return stripPassword(u);
}
