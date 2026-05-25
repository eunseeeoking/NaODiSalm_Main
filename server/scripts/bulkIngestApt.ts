/**
 * 국토부 RTMS 실거래 대량 적재 CLI (2026-05-24 신규)
 *
 *  ▷ 목적
 *    t_apt_trade / t_apt_rent 의 시계열 갭(64개월 → 124개월)을 메우기 위한
 *    야간 배치 스크립트. 서울 25구 × N개월 자동 순회 + 체크포인트 재개.
 *
 *  ▷ 환경변수 (server/.env)
 *    MOLIT_SERVICE_KEY=...           (필수, 기존)
 *    BULK_START_YM=201501            (시작월 YYYYMM)
 *    BULK_END_YM=201912              (종료월 YYYYMM)
 *    BULK_SLEEP_MS=500               (호출 간 슬립, 기본 1000)
 *    BULK_SIGUNGU_CODES=11680,11650  (콤마구분, 생략 시 서울 25구 전체)
 *    BULK_RETRY=2                    (실패 시 재시도 횟수, 기본 2)
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *
 *    # 5년치(60개월) 보강 — 일반적 사용
 *    npm run ingest:apt:bulk -- --from=201501 --to=201912
 *
 *    # env 변수만 사용
 *    npm run ingest:apt:bulk
 *
 *    # 단일 시군구 테스트
 *    npm run ingest:apt:bulk -- --from=201501 --to=201503 --codes=11680
 *
 *    # 처음부터 재시작 (체크포인트 무시)
 *    npm run ingest:apt:bulk -- --from=201501 --to=201912 --reset
 *
 *    # Dry-run (월/시군구 리스트만 출력)
 *    npm run ingest:apt:bulk -- --from=201501 --to=201912 --dry
 *
 *  ▷ 체크포인트
 *    실행 중 reports/ingest-checkpoint.json 에 완료 (code, ym) 기록.
 *    크래시/Ctrl+C 후 같은 --from/--to 로 재실행하면 미완료 분만 처리.
 *
 *  ▷ 추정 소요시간 (서울 25구 × 60개월 = 1,500 step)
 *    sleepMs=500 → 약 12.5분 + DB 쓰기 ≈ 15~20분
 *    sleepMs=1000 → 약 25분 + DB ≈ 30~40분
 *    rate-limit 만나면 자동 재시도 후 quota 패턴이면 중단
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { ingestSigunguMonth } from '../src/services/ingest/aptIngest';
import { buildMonthRange } from '../src/services/ingest/bulkRunner';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';
import { prisma } from '../src/services/db';

/* ─── CLI 인수 파싱 ──────────────────────────────────────── */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const fromYM = arg('from') ?? process.env.BULK_START_YM;
const toYM   = arg('to')   ?? process.env.BULK_END_YM;
const codesArg = arg('codes') ?? process.env.BULK_SIGUNGU_CODES;
const sleepMs  = parseInt(arg('sleep') ?? process.env.BULK_SLEEP_MS ?? '1000', 10);
const retryMax = parseInt(arg('retry') ?? process.env.BULK_RETRY ?? '2', 10);
const dryRun   = has('dry');
const reset    = has('reset');

/* ─── 검증 ───────────────────────────────────────────────── */

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

/* ─── 시군구·월 리스트 ──────────────────────────────────── */

const months = buildMonthRange(fromYM, toYM);
if (months.length === 0) {
  console.error('[ERROR] toYM < fromYM');
  process.exit(1);
}

const allCodes = SEOUL_LAWD_CODES.map((s) => s.code);
const codes = codesArg
  ? codesArg.split(',').map((c) => c.trim()).filter((c) => /^\d{5}$/.test(c))
  : allCodes;

if (codes.length === 0) {
  console.error('[ERROR] 유효한 시군구코드 없음');
  process.exit(1);
}

/* ─── 체크포인트 ─────────────────────────────────────────── */

const CHECKPOINT_DIR = path.resolve(process.cwd(), 'reports');
const CHECKPOINT_FILE = path.join(
  CHECKPOINT_DIR,
  `ingest-checkpoint-${fromYM}-${toYM}.json`,
);

interface Checkpoint {
  fromYM: string;
  toYM:   string;
  completed: string[]; // ["11680|201501", ...]
  totalTrades: number;
  totalRents: number;
  totalComplexes: number;
  startedAt: string;
  lastUpdated: string;
}

function stepKey(code: string, ym: string) { return `${code}|${ym}`; }

function loadCheckpoint(): Checkpoint {
  if (reset) {
    console.log('[checkpoint] --reset → 체크포인트 무시, 처음부터');
  } else if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
      const cp = JSON.parse(raw) as Checkpoint;
      if (cp.fromYM === fromYM && cp.toYM === toYM) {
        console.log(
          `[checkpoint] 이어서 진행: 완료=${cp.completed.length} / 시작=${cp.startedAt}`,
        );
        return cp;
      } else {
        console.log(`[checkpoint] 다른 기간(${cp.fromYM}~${cp.toYM}) 체크포인트 발견 — 무시`);
      }
    } catch (e) {
      console.warn('[checkpoint] 파싱 실패, 새로 시작:', e);
    }
  }
  return {
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

function saveCheckpoint(cp: Checkpoint) {
  if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  cp.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), 'utf-8');
}

/* ─── Ctrl+C 처리 ───────────────────────────────────────── */

let aborted = false;
process.on('SIGINT', () => {
  console.log('\n[SIGINT] 중단 요청 — 현재 step 완료 후 종료');
  aborted = true;
});

/* ─── 메인 ──────────────────────────────────────────────── */

async function main() {
  const total = codes.length * months.length;
  console.log('=== 국토부 RTMS 대량 적재 ===');
  console.log(`  기간:        ${fromYM} ~ ${toYM} (${months.length}개월)`);
  console.log(`  시군구:      ${codes.length}개 (${codes.slice(0, 3).join(',')}${codes.length > 3 ? ',...' : ''})`);
  console.log(`  총 step:     ${total}`);
  console.log(`  sleep:       ${sleepMs}ms`);
  console.log(`  retry:       ${retryMax}회`);
  console.log(`  체크포인트:  ${CHECKPOINT_FILE}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] 실제 호출 없음. 첫 10 step 미리보기:');
    let n = 0;
    outer: for (const code of codes) {
      for (const ym of months) {
        console.log(`  ${++n}. ${code}/${ym}`);
        if (n >= 10) break outer;
      }
    }
    console.log(`  ... 총 ${total} step`);
    return;
  }

  const cp = loadCheckpoint();
  const completedSet = new Set(cp.completed);

  let stepIdx = 0;
  let processedNow = 0;
  let failed = 0;
  const t0 = Date.now();

  outer: for (const code of codes) {
    for (const ym of months) {
      stepIdx++;
      if (aborted) break outer;

      const k = stepKey(code, ym);
      if (completedSet.has(k)) {
        // 이전 체크포인트 있음 — 스킵
        continue;
      }

      let attempt = 0;
      let lastError: unknown = null;
      while (attempt <= retryMax) {
        try {
          const r = await ingestSigunguMonth(code, ym);
          cp.totalTrades += r.insertedTrades;
          cp.totalRents += r.insertedRents;
          cp.totalComplexes += r.upsertedComplexes;
          cp.completed.push(k);
          processedNow++;

          const elapsed = (Date.now() - t0) / 1000;
          const rate = processedNow / Math.max(elapsed, 0.01);
          const remaining = total - stepIdx;
          const eta = remaining / Math.max(rate, 0.01);
          console.log(
            `  [${stepIdx}/${total}] ${code}/${ym} → ` +
              `trades=${r.insertedTrades} rents=${r.insertedRents} ` +
              `(elapsed ${elapsed.toFixed(0)}s, ETA ${eta.toFixed(0)}s)`,
          );

          // 매 step 저장 (안전 우선)
          saveCheckpoint(cp);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          attempt++;
          const msg = e instanceof Error ? e.message : String(e);

          // quota 패턴 → 즉시 중단
          if (/LIMITED|EXCEEDS|REQUEST_LIMIT|LimitExceeded|quota/i.test(msg)) {
            console.error(`[quota] ${code}/${ym} — 한도 초과 → 종료`);
            aborted = true;
            break;
          }

          if (attempt <= retryMax) {
            console.warn(
              `  [retry ${attempt}/${retryMax}] ${code}/${ym} 실패 — ${msg.slice(0, 80)}`,
            );
            await new Promise((r) => setTimeout(r, sleepMs * 2));
          }
        }
      }

      if (lastError) {
        failed++;
        console.error(
          `  [FAIL] ${code}/${ym} 최종 실패 — ${
            lastError instanceof Error ? lastError.message.slice(0, 100) : String(lastError)
          }`,
        );
      }

      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  saveCheckpoint(cp);

  const elapsed = ((Date.now() - t0) / 60).toFixed(1);
  console.log('\n=== 적재 완료 ===');
  console.log(`  상태:       ${aborted ? 'ABORTED' : 'DONE'}`);
  console.log(`  처리 step:  ${processedNow}/${total - completedSet.size} (전체 진행 ${cp.completed.length}/${total})`);
  console.log(`  실패 step:  ${failed}`);
  console.log(`  소요:       ${elapsed}분`);
  console.log(`  누적 trades: ${cp.totalTrades.toLocaleString()}`);
  console.log(`  누적 rents:  ${cp.totalRents.toLocaleString()}`);
  console.log(`  누적 단지:   ${cp.totalComplexes.toLocaleString()}`);
  console.log(`\n  체크포인트: ${CHECKPOINT_FILE}`);

  if (cp.completed.length === total) {
    console.log('\n  ✅ 전체 완료. 체크포인트 파일 삭제 가능.');
  } else if (aborted) {
    console.log('\n  ⏸  중단됨 — 같은 명령 재실행하면 미완료 분만 이어서 진행.');
  }
}

main()
  .catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
