import crypto from 'crypto';
import {
  ingestSigunguMonth,
  type IngestSummary,
} from './aptIngest';

/**
 * 대량 ingest 백그라운드 작업.
 *  - HTTP 응답은 즉시 반환, 작업은 비동기로 진행
 *  - 진행 상황은 메모리에 저장 → /admin/ingest/status/:taskId 로 조회
 *  - 서버 재시작 시 task 정보 사라짐 (in-process map). 데모용으로 충분.
 */

export interface BulkProgress {
  taskId: string;
  status: 'running' | 'done' | 'aborted' | 'error';
  startedAt: Date;
  finishedAt: Date | null;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  currentStep: string | null;
  totalTrades: number;
  totalRents: number;
  totalComplexes: number;
  results: IngestSummary[]; // 최근 N 개만 유지 (메모리 보호)
  errors: Array<{ sigunguCode: string; yyyymm: string; message: string }>;
}

const progressMap = new Map<string, BulkProgress>();
const KEEP_LAST_RESULTS = 50;

export function getBulkProgress(taskId: string): BulkProgress | null {
  return progressMap.get(taskId) ?? null;
}

export function listAllProgress(): BulkProgress[] {
  return Array.from(progressMap.values()).sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
}

export interface BulkOptions {
  sigunguCodes: string[];
  months: string[];
  /** 호출 간 슬립(ms) — rate limit 보호. 기본 1000 */
  sleepMs?: number;
  /** "LIMITED" / "EXCEEDS" 에러 만나면 자동 중단 */
  abortOnQuota?: boolean;
}

export function startBulkIngest(opts: BulkOptions): string {
  const taskId = crypto.randomBytes(8).toString('hex');
  const totalSteps = opts.sigunguCodes.length * opts.months.length;
  const sleepMs = opts.sleepMs ?? 1000;
  const abortOnQuota = opts.abortOnQuota ?? true;

  const p: BulkProgress = {
    taskId,
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    totalSteps,
    completedSteps: 0,
    failedSteps: 0,
    currentStep: null,
    totalTrades: 0,
    totalRents: 0,
    totalComplexes: 0,
    results: [],
    errors: [],
  };
  progressMap.set(taskId, p);

  // fire-and-forget
  (async () => {
    try {
      outer: for (const code of opts.sigunguCodes) {
        for (const ym of opts.months) {
          if (p.status !== 'running') break outer;
          p.currentStep = `${code}/${ym}`;
          try {
            const r = await ingestSigunguMonth(code, ym);
            p.totalTrades += r.insertedTrades;
            p.totalRents += r.insertedRents;
            p.totalComplexes += r.upsertedComplexes;
            p.results.push(r);
            if (p.results.length > KEEP_LAST_RESULTS) {
              p.results.shift();
            }
            p.completedSteps += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            p.failedSteps += 1;
            p.errors.push({ sigunguCode: code, yyyymm: ym, message: msg });
            console.error(`[bulk ${taskId}] step ${code}/${ym} failed:`, msg);

            // 일일 한도 초과 시 자동 중단
            if (
              abortOnQuota &&
              /LIMITED|EXCEEDS|REQUEST_LIMIT|LimitExceeded|quota/i.test(msg)
            ) {
              console.warn(`[bulk ${taskId}] quota error detected — aborting`);
              p.status = 'aborted';
              break outer;
            }
          }
          await new Promise((r) => setTimeout(r, sleepMs));
        }
      }
      if (p.status === 'running') p.status = 'done';
    } catch (e) {
      p.status = 'error';
      p.errors.push({
        sigunguCode: 'BULK',
        yyyymm: '-',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      p.finishedAt = new Date();
      p.currentStep = null;
      console.log(
        `[bulk ${taskId}] finished status=${p.status} ` +
        `completed=${p.completedSteps}/${p.totalSteps} failed=${p.failedSteps} ` +
        `trades=${p.totalTrades} rents=${p.totalRents}`,
      );
    }
  })();

  return taskId;
}

export function abortBulk(taskId: string): boolean {
  const p = progressMap.get(taskId);
  if (!p || p.status !== 'running') return false;
  p.status = 'aborted';
  return true;
}

/**
 * fromYM ~ toYM (YYYYMM) 사이의 월 리스트 생성
 */
export function buildMonthRange(fromYM: string, toYM: string): string[] {
  const months: string[] = [];
  const [fy, fm] = [parseInt(fromYM.slice(0, 4)), parseInt(fromYM.slice(4))];
  const [ty, tm] = [parseInt(toYM.slice(0, 4)), parseInt(toYM.slice(4))];
  const start = fy * 12 + (fm - 1);
  const end = ty * 12 + (tm - 1);
  if (end < start) return months;
  for (let i = start; i <= end; i++) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    months.push(`${y}${String(m).padStart(2, '0')}`);
  }
  return months;
}
