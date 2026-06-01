/**
 * t_legal_dong 시드 잡 — 수도권(서울·인천·경기) 행정동 10자리 코드 일괄 적재
 *
 *  ▷ 소스: client/public/data/capital-centroids.json
 *     (서울 전용 seoul-centroids.json 의 superset: 서울 427 + 인천 158 + 경기 602 = 1187)
 *     형태: [{ code, name, sigungu, sigunguCode, sido, lat, lng }, ...]
 *     ※ 2026-05-31: 수도권 확장에 맞춰 seoul-centroids → capital-centroids 로 소스 전환,
 *       sido 고정값 제거하고 파일의 sido 를 사용.
 *
 *  ▷ 적재 정책:
 *    - 행정동 10자리 row 만 upsert (시군구 5자리 row 는 향후 작업)
 *    - sido = 파일값(서울특별시/인천광역시/경기도)
 *    - lat/lng = 파일 centroid 좌표 저장 (2026-06-01 KI-20: POI/transit 이 이름조인 없이 직접 사용)
 *    - isActive = true (모두 활성)
 *    - 같은 code 면 update (이름·좌표 변경 반영) → 재실행/서울 기존분도 안전
 *
 *  ▷ --prune (선택, 권장 1회): centroids 에 없는 **수도권(11/28/41) 10자리 레거시 행 삭제**.
 *    배경(KI-20): 이전 법정동 시드가 남긴 옛 코드 행(부천41190·양주군41710 등)이 upsert 로 정리되지 않고
 *    잔존 → t_legal_dong 입도 혼재(2564행). prune 으로 centroids universe(1187)로 단일화.
 *    ⚠️ 파괴적: 삭제 전 대상 코드/건수를 로그로 보여줌. t_legal_dong 은 FK 참조 없음(고아 safety 행은 무해).
 *
 *  ▷ 실행:
 *    cd C:\git\NaODiSalm_Main\server
 *    npm run seed:legal-dong            # 적재만(좌표 포함)
 *    npm run seed:legal-dong -- --prune # 적재 + 레거시 행 정리(권장 1회)
 *
 *  ▷ 검증:
 *    SELECT sido, COUNT(*) FROM t_legal_dong WHERE LENGTH(code)=10 GROUP BY sido;
 *    → 서울 427 · 인천 158 · 경기 602 (합 1187)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/services/db';

interface CentroidEntry {
  code: string;
  name: string;
  sigungu: string;
  sigunguCode: string;
  sido: string;
  lat: number;
  lng: number;
}

const CENTROIDS_PATH = resolve(
  __dirname,
  '../../client/public/data/capital-centroids.json',
);

const PRUNE = process.argv.includes('--prune');

async function main(): Promise<void> {
  console.log(`[seed:legal-dong] start${PRUNE ? ' (--prune 활성)' : ''}`);

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
      e.sigungu &&
      e.sido,
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
            sido: e.sido,
            sigungu: e.sigungu,
            dong: e.name,
            lat: e.lat,
            lng: e.lng,
            isActive: true,
          },
          update: {
            sido: e.sido,
            sigungu: e.sigungu,
            dong: e.name,
            lat: e.lat,
            lng: e.lng,
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

  // 3.5) --prune: centroids 에 없는 수도권 10자리 레거시 행 삭제 (KI-20)
  if (PRUNE) {
    const keep = new Set(valid.map((e) => e.code));
    const capitalRows = await prisma.legalDong.findMany({
      where: {
        OR: [
          { code: { startsWith: '11' } },
          { code: { startsWith: '28' } },
          { code: { startsWith: '41' } },
        ],
      },
      select: { code: true, sigungu: true },
    });
    const stale = capitalRows.filter((r) => r.code.length === 10 && !keep.has(r.code));
    if (stale.length === 0) {
      console.log('[seed:legal-dong] --prune: 삭제 대상 레거시 행 없음 (이미 정리됨)');
    } else {
      // 레거시 시군구 분포 미리보기
      const bySigungu: Record<string, number> = {};
      for (const r of stale) bySigungu[r.sigungu] = (bySigungu[r.sigungu] ?? 0) + 1;
      console.log(`[seed:legal-dong] --prune: 레거시 10자리 행 ${stale.length}개 삭제 예정`);
      console.log(`  분포: ${Object.entries(bySigungu).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      const staleCodes = stale.map((r) => r.code);
      const DEL_BATCH = 200;
      let deleted = 0;
      for (let i = 0; i < staleCodes.length; i += DEL_BATCH) {
        const res = await prisma.legalDong.deleteMany({
          where: { code: { in: staleCodes.slice(i, i + DEL_BATCH) } },
        });
        deleted += res.count;
      }
      console.log(`[seed:legal-dong] --prune: ${deleted}개 삭제 완료`);
    }
  }

  // 4) 결과 점검 (수도권 시도별, 10자리 행정동만 — 5자리 시군구 마스터 제외)
  const rows = await prisma.$queryRaw<Array<{ pfx: string; c: bigint }>>`
    SELECT SUBSTRING(code, 1, 2) AS pfx, COUNT(*) AS c
    FROM t_legal_dong
    WHERE LENGTH(code) = 10 AND (code LIKE '11%' OR code LIKE '28%' OR code LIKE '41%')
    GROUP BY SUBSTRING(code, 1, 2)
  `;
  const cnt = (pfx: string) => Number(rows.find((r) => r.pfx === pfx)?.c ?? 0);
  const seoul = cnt('11'), incheon = cnt('28'), gyeonggi = cnt('41');
  console.log(
    `[seed:legal-dong] 완료 — t_legal_dong 10자리: 서울 ${seoul} · 인천 ${incheon} · 경기 ${gyeonggi} (합 ${seoul + incheon + gyeonggi})`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed:legal-dong] 실패:', e);
  await prisma.$disconnect();
  process.exit(1);
});
