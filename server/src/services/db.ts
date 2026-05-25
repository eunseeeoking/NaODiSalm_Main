import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient 싱글톤.
 *
 * 개발 모드에서 tsx watch 가 모듈을 재로드할 때마다 new PrismaClient() 를 호출하면
 * 커넥션이 누적되어 "too many connections" 에러가 발생한다.
 * globalThis 에 저장해 핫리로드 시에도 단일 인스턴스를 재사용한다.
 *
 * 운영 모드에서는 한 번만 생성된다.
 *
 * ── charset 주의 ──────────────────────────────────────────────────────────
 *  Prisma MySQL 커넥터는 DATABASE_URL 의 ?charset=utf8mb4 파라미터를
 *  SET NAMES 에 전달하지 않는다. (커넥터 내부 제한)
 *  → $connect() 후 SET NAMES utf8mb4 를 명시적으로 실행한다.
 *  → 개발 서버 커넥션 풀에서 최초 1회 실행 (tsx watch globalThis 재사용으로 안전)
 * ──────────────────────────────────────────────────────────────────────────
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaCharsetSet: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// SET NAMES utf8mb4 — 한 번만 실행 (hot-reload 시 globalThis 재사용으로 중복 방지)
if (!globalForPrisma.prismaCharsetSet) {
  globalForPrisma.prismaCharsetSet = true;
  prisma.$connect()
    .then(() =>
      prisma.$executeRawUnsafe("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"),
    )
    .then(() => console.log('[db] SET NAMES utf8mb4 ✓'))
    .catch((e) => console.error('[db] SET NAMES fail:', e));
}

/**
 * 그레이스풀 셧다운 시 호출. (server/src/index.ts 에서 SIGTERM 핸들러에 연결 가능)
 */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
