/**
 * 통계청 소득 분위 시드 — t_income_quintile (1회 실행)
 *
 *  출처: 통계청 가계금융복지조사 2023년 (KOSIS 공표 기준)
 *        https://kosis.kr — "소득분위별 가계수지(월평균)"
 *
 *  5분위 월 평균 가처분소득 (세후 실수령 기준):
 *    1분위: 130만원  (하위 20%, 무직·저소득 가구 포함)
 *    2분위: 274만원  (20~40%)
 *    3분위: 403만원  (40~60%, 중위 소득 — RIR 기본값)
 *    4분위: 577만원  (60~80%)
 *    5분위: 1057만원 (상위 20%, 맞벌이·전문직 가구 다수)
 *
 *  사용:
 *    - scoring.ts: calcRir(price, income) — 사용자 소득 미입력 시 3분위 403만원 기본값
 *    - (선택) 사용자가 소득 분위 선택 시 해당 분위 평균으로 RIR 산출
 *
 *  실행: npm run seed:income
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';

const QUINTILE_DATA = [
  {
    quintile: 1,
    avgIncome: 130,
    description: '하위 20% — 월평균 130만원 (무직·저소득 가구 포함)',
  },
  {
    quintile: 2,
    avgIncome: 274,
    description: '20~40% — 월평균 274만원',
  },
  {
    quintile: 3,
    avgIncome: 403,
    description: '40~60% — 월평균 403만원 (중위소득 기준, RIR 기본값)',
  },
  {
    quintile: 4,
    avgIncome: 577,
    description: '60~80% — 월평균 577만원',
  },
  {
    quintile: 5,
    avgIncome: 1057,
    description: '상위 20% — 월평균 1,057만원 (맞벌이·전문직 가구)',
  },
];

async function main() {
  console.log('[seed:income] 통계청 소득 분위 시드 시작');

  let upserted = 0;
  for (const row of QUINTILE_DATA) {
    await prisma.incomeQuintile.upsert({
      where: { quintile: row.quintile },
      update: {
        avgIncome: row.avgIncome,
        description: row.description,
      },
      create: row,
    });
    console.log(
      `  ${row.quintile}분위: 월 ${row.avgIncome.toLocaleString()}만원 — ${row.description}`,
    );
    upserted++;
  }

  console.log(`\n[seed:income] 완료 — ${upserted}건 upsert`);
  console.log('[seed:income] scoring.ts DEFAULT_MONTHLY_INCOME_MANWON = 403 (3분위) 기본값 적용 중');
}

main()
  .catch((e) => {
    console.error('[seed:income] 오류:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
