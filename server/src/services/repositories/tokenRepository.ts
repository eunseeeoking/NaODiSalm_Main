import { prisma } from '../db';
import {
  ACCESS_TTL_MS,
  generateRefreshToken,
  refreshTtlMs,
  sha256,
  signAccessToken,
} from '../auth/tokens';

/**
 * t_user_token 에 대한 세션 관리 함수.
 *  - createSession : 로그인 직후 호출 (refresh + access 동시 발급, 새 행 생성)
 *  - rotateSession : refresh 사용 시 호출 (이전 행 revoke + 새 행 발급 → access 재발급)
 *  - revokeByRefresh : 로그아웃 시 호출
 *  - findValidByRefresh : refresh 검증
 */

export interface IssuedTokens {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function createSession(
  userId: number,
  rememberMe: boolean,
  meta: SessionMeta = {},
): Promise<IssuedTokens> {
  const access = signAccessToken(userId);
  const refresh = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + refreshTtlMs(rememberMe));

  await prisma.userToken.create({
    data: {
      userId,
      refreshTokenHash: refresh.hash,
      accessTokenHash: sha256(access.token),
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt,
      rememberMe,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });

  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt,
  };
}

/**
 * 회전(rotation):
 *  - 기존 row 의 revoked_at 기록 + 새 row 생성 (rememberMe 는 그대로 승계)
 *  - 이전 refresh 가 다시 시도되면(재사용 공격 의심) findValidByRefresh 가 null 반환
 */
export async function rotateSession(
  oldRefreshToken: string,
  meta: SessionMeta = {},
): Promise<IssuedTokens | null> {
  const oldHash = sha256(oldRefreshToken);
  const old = await prisma.userToken.findUnique({
    where: { refreshTokenHash: oldHash },
  });

  if (!old || old.revokedAt || old.refreshExpiresAt.getTime() < Date.now()) {
    return null;
  }

  // 트랜잭션: 이전 토큰 폐기 + 새 토큰 발급
  return prisma.$transaction(async (tx) => {
    await tx.userToken.update({
      where: { id: old.id },
      data: { revokedAt: new Date() },
    });

    const access = signAccessToken(old.userId);
    const refresh = generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + refreshTtlMs(old.rememberMe),
    );

    await tx.userToken.create({
      data: {
        userId: old.userId,
        refreshTokenHash: refresh.hash,
        accessTokenHash: sha256(access.token),
        accessExpiresAt: access.expiresAt,
        refreshExpiresAt,
        rememberMe: old.rememberMe,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshExpiresAt,
    };
  });
}

export async function revokeByRefresh(refreshToken: string): Promise<void> {
  const hash = sha256(refreshToken);
  await prisma.userToken.updateMany({
    where: { refreshTokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await prisma.userToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// 참고: ACCESS_TTL_MS 는 import 만 위해 재export
export { ACCESS_TTL_MS };
