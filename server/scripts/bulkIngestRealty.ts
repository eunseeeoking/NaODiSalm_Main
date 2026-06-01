/**
 * 비-아파트 전월세 대량 적재 CLI (오피스텔/연립다세대/단독다가구).
 *
 *  ▷ bulkIngestApt.ts 의 형제 스크립트. 차이점은 --type 플래그로 유형을 고른다.
 *    유형별 분리 테이블(t_offi_*, t_villa_*, t_sh_*)에 적재.
 *
 *  ▷ 활용승인 현황
 *    OFFI(오피스텔)  ✅ 승인 — 바로 실행 가능
 *    VILLA(연립다세대) ⏳ 활용신청 필요 (RTMSDataSvcRHRent/RHTrade)
 *    SH(단독/다가구)   ⏳ 활용신청 필요 (RTMSDataSvcSHRent), 매매 없음
 *
 *  ▷ 환경변수 (server/.env)
 *    MOLIT_SERVICE_KEY=...
 *    BULK_START_YM / BULK_END_YM / BULK_SLEEP_MS / BULK_SIGUNGU_CODES / BULK_RETRY
 *    BULK_REGION=capital  (seoul|capital|incheon|gyeonggi, 생략 시 seoul)
 *
 *  ▷ 실행 예시
 *    cd C:\git\NaODiSalm_Main\server
 *
 *    # 오피스텔 최근 2년 (서울 25구)
 *    npm run ingest:realty:bulk -- --type=OFFI --from=202405 --to=202604
 *
 *    # ⭐ 오피스텔 수도권 전체(82개) 2년치 — 코드 수동 입력 불필요
 *    npm run ingest:realty:bulk -- --type=OFFI --from=202406 --to=202605 --region=capital
 *
 *    # 단일 구 테스트 + 디버그(필드명 확인)
 *    MOLIT_DEBUG=1 npm run ingest:realty:bulk -- --type=OFFI --from=202504 --to=202504 --codes=11680
 *
 *    # 여러 유형 동시 (콤마)
 *    npm run ingest:realty:bulk -- --type=OFFI,VILLA --from=202401 --to=202604
 *
 *    # dry-run (호출 없이 step 미리보기)
 *    npm run ingest:realty:bulk -- --type=OFFI --from=202401 --to=202604 --dry
 *
 *  ▷ 체크포인트: reports/ingest-realty-checkpoint-{type}-{from}-{to}.json
 *    같은 명령 재실행 시 미완료분만 이어서 진행. --reset 으로 무시.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  ingestRealtySigunguMonth,
  type RealtyIngestSummary,
} from '../src/services/ingest/realtyIngest';
import { buildMonthRange } from '../src/services/ingest/bulkRunner';
import {
  lawdCodesByRegion,
  LAWD_REGIONS,
  type LawdRegion,
} from '../src/data/seoulLawdCodes';
import type { PropertyType } from '../src/services/external/molit';
import { prisma } from '../src/services/db';

/* ─── CLI 인수 ─────────────────────────────────────────────── */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const VALID_TYPES: PropertyType[] = ['APT', 'OFFI', 'VILLA', 'SH'];

const typeArg = (arg('type') ?? 'OFFI').toUpperCase();
const types = typeArg
  .split(',')
  .map((t) => t.trim())
  .filter((t): t is PropertyType => VALID_TYPES.includes(t as PropertyType));

const fromYM = arg('from') ?? process.env.BULK_START_YM;
const toYM = arg('to') ?? process.env.BULK_END_YM;
const codesArg = arg('codes') ?? process.env.BULK_SIGUNGU_CODES;
const regionArg = (arg('region') ?? process.env.BULK_REGION ?? 'seoul').toLowerCase();
const sleepMs = parseInt(arg('sleep') ?? process.env.BULK_SLEEP_MS ?? '1000', 10);
const retryMax = parseInt(arg('retry') ?? process.env.BULK_RETRY ?? '2', 10);
const dryRun = has('dry');
const reset = has('reset');

/* ─── 검증 ─────────────────────────────────────────────────── */

if (types.length === 0) {
  console.error(`[ERROR] --type 은 ${VALID_TYPES.join('|')} 중 하나 (콤마 다중 허용)`);
  process.exit(1);
}
if (!fromYM || !/^\d{6}$/.test(fromYM)) {
  console.error('[ERROR] --from=YYYYMM 또는 BULK_START_YM 필요');
  process.exit(1);
}
if (!toYM || !/^\d{6}$/.test(toYM)) {
  console.error('[ERROR] --to=YYYYMM 또는 BULK_END_YM 필요');
  process.exit(1);
}
if (!process.env.MOLIT_SERVICE_KEY) {
  console.error('[ERROR] MOLIT_SERVICE_KEY 환경변수 미설정');
  process.exit(1);
}

const months = buildMonthRange(fromYM, toYM);
if (months.length === 0) {
  console.error('[ERROR] toYM < fromYM');
  process.exit(1);
}

// 코드 결정 우선순위: --codes(가장 구체적) > --region > 기본 seoul
if (!codesArg && !LAWD_REGIONS.includes(regionArg as LawdRegion)) {
  console.error(`[ERROR] --region 은 ${LAWD_REGIONS.join('|')} 중 하나 (기본 seoul)`);
  process.exit(1);
}
const codes = codesArg
  ? codesArg.split(',').map((c) => c.trim()).filter((c) => /^\d{5}$/.test(c))
  : lawdCodesByRegion(regionArg as LawdRegion);
if (codes.length === 0) {
  console.error('[ERROR] 유효한 시군구코드 없음');
  process.exit(1);
}
console.log(
  `[bulk:realty] 대상 시군구 ${codes.length}개 ` +
    (codesArg ? '(--codes 지정)' : `(--region=${regionArg})`),
);

/* ─── 체크포인트 ───────────────────────────────────────────── */

const CHECKPOINT_DIR = path.resolve(process.cwd(), 'reports');

interface Checkpoint {
  type: string;
  fromYM: string;
  toYM: string;
  completed: string[];
  totalTrades: number;
  totalRents: number;
  totalComplexes: number;
  startedAt: string;
  lastUpdated: string;
}

function checkpointFile(type: PropertyType): string {
  return path.join(
    CHECKPOINT_DIR,
    `ingest-realty-checkpoint-${type}-${fromYM}-${toYM}.json`,
  );
}

function loadCheckpoint(type: PropertyType): Checkpoint {
  const file = checkpointFile(type);
  if (!reset && fs.existsSync(file)) {
    try {
      const cp = JSON.parse(fs.readFileSync(file, 'utf-8')) as Checkpoint;
      if (cp.fromYM === fromYM && cp.toYM === toYM) {
        console.log(`[checkpoint:${type}] 이어서 진행: 완료=${cp.completed.length}`);
        return cp;
      }
    } catch {
      /* fallthrough → 새로 시작 */
    }
  }
  return {
    type,
    fromYM,
    toYM,
    completed: [],
    totalTrades: 0,
    totalRents: 0,
    totalComplexes: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveCheckpoint(type: PropertyType, cp: Checkpoint) {
  if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  cp.lastUpdated = new Date().toISOString();
  fs.writeFileSync(checkpointFile(type), JSON.stringify(cp, null, 2), 'utf-8');
}

/* ─── Ctrl+C ───────────────────────────────────────────────── */

let aborted = false;
process.on('SIGINT', () => {
  console.log('\n[SIGINT] 중단 요청 — 현재 step 완료 후 종료');
  aborted = true;
});

/* ─── 단일 유형 처리 ───────────────────────────────────────── */

async function runType(type: PropertyType) {
  const total = codes.length * months.length;
  console.log(`\n=== [${type}] RTMS 전월세 대량 적재 ===`);
  console.log(`  기간: ${fromYM}~${toYM} (${months.length}개월) · 시군구 ${codes.length}개 · 총 ${total} step`);

  if (dryRun) {
    console.log(`  [DRY-RUN] 첫 5 step: ${codes.slice(0, 1).flatMap((c) => months.slice(0, 5).map((m) => `${c}/${m}`)).join(', ')} ...`);
    return;
  }

  const cp = loadCheckpoint(type);
  const completedSet = new Set(cp.completed);
  let stepIdx = 0;
  let processedNow = 0;
  let failed = 0;
  const t0 = Date.now();

  outer: for (const code of codes) {
    for (const ym of months) {
      stepIdx++;
      if (aborted) break outer;
      const k = `${code}|${ym}`;
      if (completedSet.has(k)) continue;

      let attempt = 0;
      let lastError: unknown = null;
      while (attempt <= retryMax) {
        try {
          const r: RealtyIngestSummary = await ingestRealtySigunguMonth(type, code, ym);
          cp.totalTrades += r.insertedTrades;
          cp.totalRents += r.insertedRents;
          cp.totalComplexes += r.upsertedComplexes;
          cp.completed.push(k);
          processedNow++;
          const elapsed = (Date.now() - t0) / 1000;
          console.log(
            `  [${type} ${stepIdx}/${total}] ${code}/${ym} → ` +
              `trades=${r.insertedTrades} rents=${r.insertedRents} (elapsed ${elapsed.toFixed(0)}s)`,
          );
          saveCheckpoint(type, cp);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          attempt++;
          const msg = e instanceof Error ? e.message : String(e);
          if (/LIMITED|EXCEEDS|REQUEST_LIMIT|LimitExceeded|quota/i.test(msg)) {
            console.error(`[quota] ${type} ${code}/${ym} — 한도 초과 → 종료`);
            aborted = true;
            break;
          }
          if (attempt <= retryMax) {
            console.warn(`  [retry ${attempt}/${retryMax}] ${type} ${code}/${ym} — ${msg.slice(0, 80)}`);
            await new Promise((res) => setTimeout(res, sleepMs * 2));
          }
        }
      }
      if (lastError) {
        failed++;
        console.error(`  [FAIL] ${type} ${code}/${ym} — ${lastError instanceof Error ? lastError.message.slice(0, 100) : String(lastError)}`);
      }
      await new Promise((res) => setTimeout(res, sleepMs));
    }
  }

  saveCheckpoint(type, cp);
  console.log(`  [${type}] 완료 step ${cp.completed.length}/${total} · 실패 ${failed} · 누적 rents ${cp.totalRents.toLocaleString()} · 단지 ${cp.totalComplexes.toLocaleString()}`);
}

/* ─── 메인 ─────────────────────────────────────────────────── */

async function main() {
  console.log(`유형: ${types.join(', ')}`);
  for (const type of types) {
    if (aborted) break;
    await runType(type);
  }
  console.log(`\n=== 전체 ${aborted ? 'ABORTED' : 'DONE'} ===`);
}

main()
  .catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
