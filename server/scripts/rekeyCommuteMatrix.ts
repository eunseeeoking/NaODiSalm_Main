/**
 * 1회용 마이그레이션 — t_commute_matrix 의 옛 4자리 cacheKey 행을 3자리로 re-key.
 *
 *  배경: 2026-06-03 캐시 키가 4자리(≈11m)→3자리(≈110m)로 바뀌면서(odsay.ts makeCacheKey),
 *        그 전에 쌓인 4자리 키 행은 findCachedMatrix(3자리 후보만 생성)에 **영영 안 잡힘**.
 *        인기 직장 칩마다 ~1188개 동 매트릭스가 통째로 고아가 돼, 매 테스트가 0부터 재축적하며
 *        ODsay 호출이 계속 늘었음. odsay.ts 주석이 예고한 "1회 마이그레이션"이 이 스크립트.
 *
 *  방식:
 *    · 각 행의 저장된 work_lat/lng 로 **런타임과 동일한 makeCacheKey(toFixed3)** 재계산 → 새 3자리 키.
 *      (쓰기/읽기 경로가 쓰는 바로 그 함수라 키가 바이트 일치 — 재키 후 즉시 read hit.)
 *    · 4자리 여러 개가 같은 3자리로 겹치면 (cache_key, legal_dong_code) 유니크 충돌 →
 *      **computed_at 최신 우선 dedup**(오늘 채운 신선한 3자리 행 보존), 나머지는 삭제.
 *
 *  실행:
 *    cd server && npx tsx scripts/rekeyCommuteMatrix.ts            # 드라이런(기본, 변경 없음)
 *    cd server && npx tsx scripts/rekeyCommuteMatrix.ts --apply    # 실제 적용 + 검증
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { makeCacheKey } from '../src/services/external/odsay';
import { findCachedMatrix } from '../src/services/repositories/commuteRepository';

const APPLY = process.argv.includes('--apply');

interface Row {
  id: number;
  cacheKey: string;
  workLat: number;
  workLng: number;
  workLabel: string | null;
  legalDongCode: string;
  computedAt: Date;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const rows = (await prisma.commuteMatrix.findMany({
    select: {
      id: true,
      cacheKey: true,
      workLat: true,
      workLng: true,
      workLabel: true,
      legalDongCode: true,
      computedAt: true,
    },
  })) as Row[];

  // (newKey|dong) 별 최신 1행만 승자. 패자(중복)는 삭제 대상.
  const winnerByGroup = new Map<string, Row>();
  const newKeyOf = new Map<number, string>();
  for (const r of rows) {
    const nk = makeCacheKey(r.workLat, r.workLng);
    newKeyOf.set(r.id, nk);
    const gk = `${nk}|${r.legalDongCode}`;
    const cur = winnerByGroup.get(gk);
    if (!cur || r.computedAt > cur.computedAt || (r.computedAt.getTime() === cur.computedAt.getTime() && r.id > cur.id)) {
      winnerByGroup.set(gk, r);
    }
  }

  const winners = new Set([...winnerByGroup.values()].map((w) => w.id));
  const losers = rows.filter((r) => !winners.has(r.id));
  const toRekey = [...winnerByGroup.values()].filter((w) => newKeyOf.get(w.id) !== w.cacheKey);
  const alreadyOk = winners.size - toRekey.length;

  // 칩(newKey)별 복구 효과: 지금 읽히는 행(이미 3dp) → 마이그 후 읽히는 행(승자 수).
  const perKey = new Map<string, { label: string; beforeReadable: number; after: number }>();
  for (const r of rows) {
    const nk = newKeyOf.get(r.id)!;
    const e = perKey.get(nk) ?? { label: r.workLabel ?? '', beforeReadable: 0, after: 0 };
    if (r.cacheKey === nk) e.beforeReadable += 1; // 이미 3dp = 현재 읽힘
    if (!e.label && r.workLabel) e.label = r.workLabel;
    perKey.set(nk, e);
  }
  for (const w of winnerByGroup.values()) {
    const nk = newKeyOf.get(w.id)!;
    perKey.get(nk)!.after += 1;
  }

  console.log(`\n=== rekeyCommuteMatrix ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ===`);
  console.log(`스캔 행            : ${rows.length}`);
  console.log(`마이그 후 잔존(승자): ${winners.size}`);
  console.log(`삭제(중복 dedup)   : ${losers.length}`);
  console.log(`키 변경(re-key)    : ${toRekey.length}`);
  console.log(`변경 없음(이미 3dp): ${alreadyOk}`);

  const report = [...perKey.entries()]
    .map(([nk, e]) => ({ newKey: nk, label: e.label, 현재읽힘: e.beforeReadable, 마이그후: e.after, 복구: e.after - e.beforeReadable }))
    .filter((r) => r.복구 > 0)
    .sort((a, b) => b.복구 - a.복구);
  console.log(`\n=== 칩별 복구되는 동 수 (현재 읽힘 → 마이그 후) ===`);
  console.table(report.slice(0, 20));

  if (!APPLY) {
    console.log('\n드라이런 — 변경 없음. 적용하려면 --apply 로 재실행.');
    await prisma.$disconnect();
    return;
  }

  // ── 적용 ──────────────────────────────────────────────────────
  // 1) 패스: 패자 삭제 → (newKey,dong) 가 잔존 행에서 유일해짐 → 2) 재키 시 유니크 충돌 없음.
  let deleted = 0;
  for (const ids of chunk(losers.map((l) => l.id), 5000)) {
    const r = await prisma.commuteMatrix.deleteMany({ where: { id: { in: ids } } });
    deleted += r.count;
  }
  // 2) 잔존 승자 중 키가 바뀌는 것만 newKey 로 갱신 (newKey 별로 묶어 IN 업데이트).
  const byNewKey = new Map<string, number[]>();
  for (const w of toRekey) {
    const nk = newKeyOf.get(w.id)!;
    (byNewKey.get(nk) ?? byNewKey.set(nk, []).get(nk)!).push(w.id);
  }
  let updated = 0;
  for (const [nk, ids] of byNewKey) {
    for (const idChunk of chunk(ids, 5000)) {
      const r = await prisma.commuteMatrix.updateMany({ where: { id: { in: idChunk } }, data: { cacheKey: nk } });
      updated += r.count;
    }
  }
  console.log(`\n적용 완료 — 삭제 ${deleted} · 재키 ${updated}`);

  // 3) 검증: 실제 read 경로(findCachedMatrix)로 대표 칩 hit 수 확인.
  const sample = report.slice(0, 5);
  console.log(`\n=== 검증: findCachedMatrix 실제 read (dongCodes 미지정 = 9격자 전체) ===`);
  for (const s of sample) {
    const [latStr, lngStr] = s.newKey.split('_');
    const hit = await findCachedMatrix({ lat: Number(latStr), lng: Number(lngStr) });
    console.log(`  ${s.label.padEnd(10)} ${s.newKey}  →  read hit ${hit.size}개 (기대 ≈ ${s.마이그후})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
