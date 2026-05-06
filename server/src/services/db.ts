import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient 싱글톤.
 *
 * 개발 모드에서 tsx watch 가 모듈을 재로드할 때마다 new PrismaClient() 를 호출하면
 * 커넥션이 누적되어 "too many connections" 에러가 발생한다.
 * globalThis 에 저장해 핫리로드 시에도 단일 인스턴스를 재사용한다.
 *
 * 운영 모드에서는 한 번만 생성된다.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * 그레이스풀 셧다운 시 호출. (server/src/index.ts 에서 SIGTERM 핸들러에 연결 가능)
 */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
