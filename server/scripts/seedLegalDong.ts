/**
 * t_legal_dong 시드 잡 — 서울 행정동 10자리 코드 일괄 적재
 *
 *  ▷ 소스: client/public/data/seoul-centroids.json
 *     (2026-05-19 work-log §2 에서 만든 자산, 모노레포라 직접 읽음)
 *     형태: [{ code, name, sigungu, sigunguCode, lat, lng }, ...]
 *
 *  ▷ 적재 정책:
 *    - 행정동 10자리 row 만 upsert (시군구 5자리 row 는 향후 작업)
 *    - sido = "서울특별시" 고정 (전국 확장 시 별도 시드)
 *    - isActive = true (모두 활성)
 *    - 같은 code 면 update (이름 등 변경 반영)
 *
 *  ▷ 실행:
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npx tsx scripts/seedLegalDong.ts
 *
 *  ▷ 검증:
 *    SELECT COUNT(*) FROM t_legal_dong WHERE LENGTH(code) = 10 AND code LIKE '11%';
 *    → ~470건 (서울 행정동 수)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/services/db';

interface CentroidEntry {
  code: string;
  name: string;
  sigungu: string;
  sigunguCode: string;
  lat: number;
  lng: number;
}

const CENTROIDS_PATH = resolve(
  __dirname,
  '../../client/public/data/seoul-centroids.json',
);
const SIDO = '서울특별시';

async function main(): Promise<void> {
  console.log('[seed:legal-dong] start');

  // 1) 파일 로드
  let raw: string;
  try {
    raw = readFileSync(CENTROIDS_PATH, 'utf8');
  } catch (e) {
    console.error(`[seed:legal-dong] 파일 읽기 실패: ${CENTROIDS_PATH}`);
    throw e;
  }
  const entries = JSON.parse(raw) as CentroidEntry[];
  console.log(`[seed:legal-dong] 입력: ${entries.length} entries`);

  // 2) 유효성 점검 — 10자리 code + name + sigungu 필수
  const valid = entries.filter(
    (e) =>
      typeof e.code === 'string' &&
      e.code.length === 10 &&
      e.name &&
      e.sigungu,
  );
  if (valid.length !== entries.length) {
    console.warn(
      `[seed:legal-dong] 유효성 검증 후 ${valid.length} / ${entries.length} 통과`,
    );
  }

  // 3) bulk upsert — Prisma 에는 진짜 bulk upsert 가 없어 트랜잭션 batch 로 처리
  //    한 번에 50개씩 트랜잭션으로 묶음 (커넥션 점유 시간 ↓)
  const BATCH = 50;
  let upserts = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((e) =>
        prisma.legalDong.upsert({
          where: { code: e.code },
          create: {
            code: e.code,
            sido: SIDO,
            sigungu: e.sigungu,
            dong: e.name,
            isActive: true,
          },
          update: {
            sido: SIDO,
            sigungu: e.sigungu,
            dong: e.name,
            isActive: true,
          },
        }),
      ),
    );
    upserts += chunk.length;
    if (upserts % 100 === 0 || upserts === valid.length) {
      console.log(`[seed:legal-dong] ${upserts} / ${valid.length}`);
    }
  }

  // 4) 결과 점검
  const seoulTen = await prisma.legalDong.count({
    where: { code: { startsWith: '11' } },
  });
  console.log(`[seed:legal-dong] 완료 — t_legal_dong 서울 10자리: ${seoulTen}건`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed:legal-dong] 실패:', e);
  await prisma.$disconnect();
  process.exit(1);
});
