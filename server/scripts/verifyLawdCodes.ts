/**
 * 수도권 LAWD_CD 검증 CLI (2026-05-31 신규)
 *
 *  ▷ 목적
 *    src/data/seoulLawdCodes.ts 의 CAPITAL_AREA_LAWD_CODES(서울·인천·경기)에
 *    하드코딩된 시군구 코드/명칭이 **실제 공식 데이터와 일치하는지** 검증한다.
 *    하드코딩 특성상 행정구역 개편(예: 부천시 구 폐지, 인천 미추홀구 개칭)으로
 *    코드가 어긋날 수 있으므로, 적재(ingest) 전에 한 번 돌려 확인하는 용도.
 *
 *  ▷ 두 가지 검증 모드
 *    1) DB 모드 (기본) — `npm run verify:lawd`
 *       로컬 t_legal_dong(법정동 마스터, `npm run seed:legal-dong` 로 적재)과 대조.
 *       각 코드가 isActive=true 로 존재하고 sido/시군구명이 맞는지 확인.
 *       비용 0, API 호출 없음. 단 t_legal_dong 이 최신이어야 신뢰 가능.
 *
 *    2) RTMS 프로브 모드 — `npm run verify:lawd -- --probe [--ym=YYYYMM]`
 *       각 코드로 국토부 RTMS(아파트 매매)를 1개월치 실제 호출.
 *       "코드를 MOLIT 이 수용하는가(=ingest 가 데이터를 받는가)" 의 ground truth.
 *       API 쿼터를 소모하므로(코드당 1콜) 슬립을 둔다. MOLIT_SERVICE_KEY 필요.
 *
 *  ▷ 종료 코드: 불일치/오류가 하나라도 있으면 1, 모두 통과면 0 (CI 친화).
 *
 *  ▷ 실행 예
 *      npm run verify:lawd                      # DB 대조
 *      npm run verify:lawd -- --probe           # RTMS 프로브(최근월 자동)
 *      npm run verify:lawd -- --probe --ym=202604
 *      npm run verify:lawd -- --region=GYEONGGI # 특정 권역만
 */

import { prisma } from '../src/services/db';
import { fetchTradesByType } from '../src/services/external/molit';
import {
  CAPITAL_AREA_LAWD_CODES,
  INCHEON_LAWD_CODES,
  GYEONGGI_LAWD_CODES,
  type LawdEntry,
} from '../src/data/seoulLawdCodes';

/* ─── CLI 인수 ─────────────────────────────────────────────── */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const PROBE = has('probe');
const REGION = (arg('region') ?? 'ALL').toUpperCase(); // ALL | SEOUL | INCHEON | GYEONGGI
const SLEEP_MS = Number(arg('sleep') ?? 700);

// 최근 신설 행정구 — RTMS LAWD_CD가 구 코드를 받는지 옛 단일코드(41190/41590)를
// 받는지 불확실하므로 --probe 로 반드시 확인(경고 표시 + 프로브 권장 대상).
const WATCH_CODES = new Set<string>([
  '41192', '41194', '41196', // 부천시 원미·소사·오정구 (구 재설치)
  '41591', '41593', '41595', '41597', // 화성시 만세·효행·병점·동탄구 (특례시 구 신설)
]);

/** 최근 확정월 추정: RTMS 는 신고지연이 있어 2개월 전 기준이 안전. */
function recentYm(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function selectedCodes(): ReadonlyArray<LawdEntry> {
  switch (REGION) {
    case 'SEOUL':
      return CAPITAL_AREA_LAWD_CODES.filter((c) => c.sido === '서울특별시');
    case 'INCHEON':
      return INCHEON_LAWD_CODES.map((c) => ({ ...c, sido: '인천광역시' }));
    case 'GYEONGGI':
      return GYEONGGI_LAWD_CODES.map((c) => ({ ...c, sido: '경기도' }));
    default:
      return CAPITAL_AREA_LAWD_CODES;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─── 0) 자체 정합성: 코드 형식·중복 ───────────────────────── */

function checkSelfConsistency(codes: ReadonlyArray<LawdEntry>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const { code, name } of codes) {
    if (!/^\d{5}$/.test(code)) problems.push(`FORMAT  ${code} (${name}) — 5자리 숫자가 아님`);
    const dup = seen.get(code);
    if (dup) problems.push(`DUP     ${code} — "${name}" 와 "${dup}" 중복`);
    else seen.set(code, name);
  }
  return problems;
}

/* ─── 1) DB 모드: t_legal_dong 대조 ────────────────────────── */

async function verifyAgainstDb(codes: ReadonlyArray<LawdEntry>): Promise<string[]> {
  const issues: string[] = [];
  const total = await prisma.legalDong.count();
  if (total === 0) {
    console.error(
      '[verify] t_legal_dong 이 비어있음 — 먼저 `npm run seed:legal-dong` 실행 후 재시도하거나 --probe 사용',
    );
    return ['DB     t_legal_dong 비어있음'];
  }

  for (const entry of codes) {
    const { code, name, sido } = entry;
    // 5자리 시군구 코드 또는 그 하위 10자리 법정동 행을 prefix 로 조회.
    const rows = await prisma.legalDong.findMany({
      where: { code: { startsWith: code }, isActive: true },
      select: { code: true, sido: true, sigungu: true },
      take: 5,
    });

    if (rows.length === 0) {
      const line = `❌ MISSING   ${code} ${sido} ${name} — t_legal_dong 에 활성 행 없음`;
      console.log(line);
      issues.push(line);
      continue;
    }
    const sidoMismatch = rows.find((r) => r.sido !== sido);
    if (sidoMismatch) {
      const line = `❌ SIDO      ${code} ${name} — 기대 "${sido}", DB "${sidoMismatch.sido}"`;
      console.log(line);
      issues.push(line);
      continue;
    }
    // 시군구명: DB 가 "수원시 영통구" 또는 "영통구" 형태일 수 있어 양방향 포함 비교.
    const nameOk = rows.some(
      (r) => r.sigungu === name || r.sigungu.includes(name) || name.includes(r.sigungu),
    );
    if (!nameOk) {
      const line = `⚠️  NAME      ${code} — 상수 "${name}", DB "${rows[0].sigungu}" (확인 필요)`;
      console.log(line);
      issues.push(line);
      continue;
    }
    const watch = WATCH_CODES.has(code) ? '  (개편 이력 — 재확인 권장)' : '';
    console.log(`✅ OK        ${code} ${sido} ${name}${watch}`);
  }
  return issues;
}

/* ─── 2) 프로브 모드: RTMS 실제 호출 ───────────────────────── */

async function verifyByProbe(codes: ReadonlyArray<LawdEntry>): Promise<string[]> {
  const ym = arg('ym') ?? recentYm();
  console.log(`[verify] RTMS 프로브 — 기준월 ${ym}, 코드 ${codes.length}개 (APT 매매)\n`);
  const issues: string[] = [];

  for (const { code, name, sido } of codes) {
    const isWatch = WATCH_CODES.has(code);
    try {
      const rows = await fetchTradesByType('APT', code, ym);
      const watch = isWatch ? '  (개편 이력)' : '';
      if (rows.length > 0) {
        console.log(`✅ OK        ${code} ${sido} ${name} — ${rows.length}건${watch}`);
      } else {
        // 0건은 "코드 오류"와 "해당 월 거래 없음"을 구분 못함.
        // WATCH(신설 구)면 코드 거부 의심 → 경고 수집. 일반 시군구는 거래無일 수 있어 참고만.
        const line = `⚠️  EMPTY     ${code} ${sido} ${name} — 0건${isWatch ? ' ★신설구 코드수용 의심' : ' (해당월 거래無 가능)'}`;
        console.log(line);
        if (isWatch) issues.push(line);
        else console.log(`             ↑ 일반 시군구 0건은 보통 정상(다른 월/--ym 으로 재확인 가능)`);
      }
    } catch (e) {
      const line = `❌ ERROR     ${code} ${sido} ${name} — ${(e as Error).message}`;
      console.log(line);
      issues.push(line);
    }
    await sleep(SLEEP_MS);
  }
  return issues;
}

/* ─── main ─────────────────────────────────────────────────── */

async function main() {
  const codes = selectedCodes();
  console.log(
    `[verify] 대상: ${REGION} · ${codes.length}개 코드 · 모드: ${PROBE ? 'RTMS 프로브' : 'DB 대조'}\n`,
  );

  const selfIssues = checkSelfConsistency(codes).map((p) => `❌ ${p}`);
  for (const p of selfIssues) console.log(p);

  const issues = [
    ...selfIssues,
    ...(PROBE ? await verifyByProbe(codes) : await verifyAgainstDb(codes)),
  ];

  // ── 요약: 걸린 항목만 마지막에 다시 모아 표시(82줄 스크롤 불필요) ──
  console.log(`\n${'─'.repeat(60)}`);
  if (issues.length === 0) {
    console.log(`[verify] ✅ 전부 통과 — 총 ${codes.length}코드, 문제 0건`);
  } else {
    console.log(`[verify] ⚠️ 확인 필요 ${issues.length}건 / 총 ${codes.length}코드:`);
    for (const line of issues) console.log(`   ${line}`);
    console.log(
      `\n   ※ ★신설구 항목이면 RTMS가 구 코드를 거부하는 것 → 옛 단일코드(부천 41190·화성 41590)로\n` +
        `     alias 매핑 필요. 일반 시군구 0건은 보통 정상(해당 월 거래 없음).`,
    );
  }
  await prisma.$disconnect();
  process.exit(issues.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('[verify] 치명적 오류:', e);
  await prisma.$disconnect();
  process.exit(1);
});
