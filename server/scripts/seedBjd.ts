/**
 * 법정동코드 (BJD) 시드 잡 — kr-legal-dong GitHub JSON 자동 fetch
 *
 *  ▷ 데이터 소스
 *    https://github.com/kr-legal-dong/kr-legal-dong
 *      · 행정안전부 BJD 코드를 정제한 공개 JSON 데이터 (archived 2024-08, 안정)
 *      · raw URL 직접 fetch — 사용자가 파일 다운로드할 필요 없음
 *
 *  ▷ 데이터 shape (사용자 확인 완료, 2026-05-21)
 *    [
 *      {
 *        "code":     "1111010100",     ← 법정동 10자리
 *        "siCode":   "1100000000",
 *        "siName":   "서울특별시",
 *        "guCode":   "1111000000",
 *        "guName":   "종로구",
 *        "fullName": "서울특별시 종로구 청운동",
 *        "name":     "청운동",          ← 법정동명
 *        "active":   true
 *      },
 *      ...
 *    ]
 *
 *  ▷ 적재 정책
 *    - 기존 t_legal_dong row 전체 DELETE (행정동/법정동 혼재 정리)
 *    - 시군구 5자리 row 도 unique guCode 기반으로 같이 시드 (sigungu_code → sigungu name 매핑용)
 *    - 동 10자리 row 일괄 시드
 *    - active=false 는 isActive=false 로 보존 (필요 시 조회 가능)
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run seed:bjd
 *
 *  ▷ 검증 (시드 후)
 *    SELECT COUNT(*) FROM t_legal_dong;
 *    SELECT COUNT(*) FROM t_legal_dong WHERE LENGTH(code)=10 AND code LIKE '11%' AND dong IS NOT NULL;
 *    -- 기대: 서울 법정동 ~470건
 */
import { prisma } from '../src/services/db';

const DATA_URL =
  'https://raw.githubusercontent.com/kr-legal-dong/kr-legal-dong/main/dong.json';

interface KrLegalDongRow {
  code: string;
  siCode?: string;
  siName: string;
  guCode?: string;
  guName: string;
  fullName?: string;
  name: string;
  active?: boolean;
}

async function main(): Promise<void> {
  console.log('[seed:bjd] fetching from kr-legal-dong/kr-legal-dong …');
  console.log(`[seed:bjd]   ${DATA_URL}`);

  // Node 18+ 의 글로벌 fetch 사용 (engines: node>=18.18.0)
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} 다운로드 실패`);
  }
  const rows = (await res.json()) as KrLegalDongRow[];
  console.log(`[seed:bjd] fetched ${rows.length} dong rows`);

  // 형식 검증 — 첫 row 의 필수 키 확인
  const first = rows[0];
  if (!first?.code || !first?.name || !first?.siName) {
    console.error('[seed:bjd] 예상치 못한 데이터 형식. 첫 row:');
    console.error(JSON.stringify(first, null, 2));
    throw new Error('unexpected shape — code/name/siName 누락');
  }

  // 시군구 unique 추출 (5자리 row 시드용)
  const sigunguMap = new Map<string, { sido: string; sigungu: string }>();
  for (const r of rows) {
    const five = (r.guCode ?? '').slice(0, 5);
    if (five.length === 5 && !sigunguMap.has(five)) {
      sigunguMap.set(five, { sido: r.siName, sigungu: r.guName });
    }
  }
  console.log(`[seed:bjd] unique 시군구 그룹: ${sigunguMap.size}`);

  // 기존 t_legal_dong row 모두 삭제
  const deleted = await prisma.legalDong.deleteMany({});
  console.log(`[seed:bjd] deleted ${deleted.count} existing rows`);

  // 1) 시군구 5자리 row 일괄 insert
  const sigunguData = Array.from(sigunguMap.entries()).map(([code, v]) => ({
    code,
    sido: v.sido,
    sigungu: v.sigungu,
    dong: null,
    isActive: true,
  }));
  if (sigunguData.length > 0) {
    await prisma.legalDong.createMany({
      data: sigunguData,
      skipDuplicates: true,
    });
    console.log(`[seed:bjd] sigungu rows inserted: ${sigunguData.length}`);
  }

  // 2) 동 10자리 row 배치 insert
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await prisma.legalDong.createMany({
      data: chunk.map((r) => ({
        code: r.code.padEnd(10, '0').slice(0, 10),
        sido: r.siName,
        sigungu: r.guName,
        dong: r.name,
        isActive: r.active !== false,
      })),
      skipDuplicates: true,
    });
    inserted += chunk.length;
    if (inserted % 5000 === 0 || inserted >= rows.length) {
      console.log(`[seed:bjd] ${Math.min(inserted, rows.length)} / ${rows.length}`);
    }
  }

  // 결과 통계
  const total = await prisma.legalDong.count();
  const seoulDongs = await prisma.legalDong.count({
    where: { code: { startsWith: '11' }, dong: { not: null } },
  });
  console.log('[seed:bjd] ─────────────────────────────────────────');
  console.log(`[seed:bjd] 완료 — t_legal_dong 총 ${total}건`);
  console.log(`[seed:bjd]        서울 법정동 (10자리 + dong) ${seoulDongs}건`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed:bjd] 실패:', e);
  await prisma.$disconnect();
  process.exit(1);
});
