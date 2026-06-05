/**
 * ODsay LAB 일일 호출량 게이트
 *
 *  ▷ 정책
 *    · 무료 한도         일 1,000건 (ODsay 계정 전체 — 로컬+prod 합산 기준)
 *    · 내부 차단 임계값  env ODSAY_DAILY_LIMIT (기본 800). 로컬·prod 카운터가 DB별로 독립이라
 *                       환경별로 나눠 합 ≤1,000 유지 (권장: 로컬 200 / prod 800).
 *    · 리셋 시각         KST 자정 (date 키 변경 시 새 row)
 *    · 카운트 단위       실제 ODsay 외부 호출 1건 = +1
 *                       (캐시 hit / 게이트 차단 / -98 -99 에러는 미카운트)
 *
 *  ▷ 호출 흐름 (fetchOdsayRoute 진입부)
 *    1) checkAndConsumeOdsayQuota()
 *       - 오늘 카운트 ≥ 800 → false 반환 → 호출자가 null 리턴
 *       - 미만 → 카운트 +1 후 true 반환 → 호출자가 실제 API 호출 진행
 *    2) (선택) 호출 실패 시 refundOdsayQuota() 로 -1 환불
 *       - 네트워크 오류 등 "ODsay 측 처리 실패" 인 경우만 환불
 *       - 정상 응답·정상 비즈 에러(경로 없음 등)는 환불 X
 *
 *  ▷ 동시성
 *    · 증가는 `INSERT ... ON DUPLICATE KEY UPDATE` 단일 문장 → 동시 호출에도 PK 충돌 없이 +1 누적.
 *    · 임계 판정은 증가 직후 findUnique 재조회라, 경계(800 부근)에서 동시 증가분이 함께 읽혀
 *      미세 over/under-count(±몇 건) 가능 — 200 마진(1000-800) 안에서 흡수되므로 허용.
 */
import { prisma } from '../db';

/**
 * 차단 임계값 — env `ODSAY_DAILY_LIMIT` 로 환경별 분할 (미설정 시 800).
 *  ⚠️ 카운터(t_odsay_usage_daily)는 **DB별로 독립**이라 로컬(MySQL)·prod(TiDB)가 따로 누적되는데,
 *     둘 다 **같은 ODsay 계정의 1,000/일 실쿼터**를 깎는다. 따라서 각 환경 캡의 **합이 1,000 이하**여야
 *     실쿼터를 안 넘긴다. 권장 분할: 로컬 .env=200, prod=800 → 합 1,000.
 *  유효하지 않은 값(NaN·≤0)이면 800 폴백.
 */
const _rawDailyLimit = Number(process.env.ODSAY_DAILY_LIMIT);
export const ODSAY_DAILY_LIMIT =
  Number.isFinite(_rawDailyLimit) && _rawDailyLimit > 0 ? Math.floor(_rawDailyLimit) : 800;

/**
 * KST 기준 오늘 날짜 'YYYY-MM-DD'
 *  - UTC + 9h 시프트 후 UTC getter 사용 → 서버 타임존 무관 안전
 */
export function todayKstYmd(now: Date = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 오늘 카운트 조회 (row 없으면 0)
 */
export async function getOdsayUsageToday(): Promise<{
  date: string;
  callCount: number;
  remaining: number;
  blocked: boolean;
}> {
  const date = todayKstYmd();
  const row = await prisma.odsayUsageDaily.findUnique({ where: { date } });
  const callCount = row?.callCount ?? 0;
  return {
    date,
    callCount,
    remaining: Math.max(0, ODSAY_DAILY_LIMIT - callCount),
    blocked: callCount >= ODSAY_DAILY_LIMIT,
  };
}

/**
 * 카운트 체크 + 점유.
 *  - true 반환: 호출자는 실제 ODsay API 호출을 진행해도 됨 (카운트 이미 +1)
 *  - false 반환: 한도 초과로 호출 차단 (호출자는 null 리턴 + Haversine 폴백)
 *
 *  ⚠️ 호출 성공 여부와 무관하게 카운트가 증가하므로,
 *     명확한 네트워크 오류로 ODsay 가 사실상 호출되지 않은 케이스는
 *     refundOdsayQuota() 로 보정.
 */
export async function checkAndConsumeOdsayQuota(): Promise<boolean> {
  const date = todayKstYmd();

  // 원자적 증가 — MySQL `INSERT ... ON DUPLICATE KEY UPDATE` **한 문장**이라 동시 호출에도
  //  PK 충돌(P2002) 없이 누계가 정확히 +1 된다.
  //  ⚠️ Prisma `upsert` 는 find→insert/update 2단계(비원자적)라, 그날 row 가 아직 없을 때
  //     fetchOdsayBatch 의 Promise.all 동시 호출이 모두 INSERT 를 시도→PK 충돌로 P2002 폭발했음.
  //  · updated_at 은 @updatedAt(앱 관리)라 raw 경로에선 DB 가 안 채움 → 명시적으로 UTC 세팅.
  await prisma.$executeRaw`
    INSERT INTO t_odsay_usage_daily (\`date\`, call_count, updated_at)
    VALUES (${date}, 1, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE call_count = call_count + 1, updated_at = UTC_TIMESTAMP(3)
  `;

  const row = await prisma.odsayUsageDaily.findUnique({ where: { date } });
  const callCount = row?.callCount ?? 1;

  if (callCount > ODSAY_DAILY_LIMIT) {
    // 임계 초과 — 방금 한 증가를 환불 (decrement 도 단일 UPDATE 라 원자적)
    await prisma.odsayUsageDaily.update({
      where: { date },
      data: { callCount: { decrement: 1 } },
    });
    return false;
  }
  return true;
}

/**
 * 카운트 환불 (-1) — checkAndConsumeOdsayQuota 가 true 반환했으나
 * 실제 호출이 네트워크 오류 등으로 ODsay 가 처리하지 않은 게 분명한 경우.
 *
 *  · 호출자: fetchOdsayRoute 의 catch 블록 (fetch reject)
 *  · 호출 안 함: HTTP 200 + 에러 응답(-98/-99), 200 정상 응답, rate-limit 에러
 *    (이미 ODsay 가 카운트했을 가능성)
 */
export async function refundOdsayQuota(): Promise<void> {
  const date = todayKstYmd();
  try {
    await prisma.odsayUsageDaily.update({
      where: { date },
      data: { callCount: { decrement: 1 } },
    });
  } catch (e) {
    // row 없으면 무시 (어차피 카운트도 없었던 셈)
    console.warn('[odsay-quota] refund noop:', e);
  }
}
