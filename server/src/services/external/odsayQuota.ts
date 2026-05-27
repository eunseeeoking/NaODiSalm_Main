/**
 * ODsay LAB 일일 호출량 게이트
 *
 *  ▷ 정책
 *    · 무료 한도         일 1,000건
 *    · 내부 차단 임계값  일   800건 (마진 20% 확보)
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
 *    · 단일 서버 / 저동시성 가정 — read-check-increment 사이 미세 race 허용
 *    · 약간 over-count(±5건) 발생해도 800 마진 안에서 흡수
 */
import { prisma } from '../db';

/** 차단 임계값 — 무료 한도(1000) 의 80% */
export const ODSAY_DAILY_LIMIT = 800;

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

  // upsert + increment 한 번에 — 동시성 안전
  const updated = await prisma.odsayUsageDaily.upsert({
    where: { date },
    create: { date, callCount: 1 },
    update: { callCount: { increment: 1 } },
  });

  if (updated.callCount > ODSAY_DAILY_LIMIT) {
    // 임계 초과 — 방금 한 증가를 환불 (정확성보다 단순함 우선)
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
