/**
 * R-ONE 실거래지수 기반 LSTM 정규화 보정 유틸
 *
 *  ▷ 핵심 아이디어 (Day 1, 2026-05-22)
 *    LSTM 이 학습하는 값 = "실거래가 ÷ 부동산원 지수"
 *      → 시장 전체 추세(노이즈) 제거
 *      → 동 단위 고유 변동만 학습
 *
 *    예측 복원:
 *      LSTM_예측값 × 최신_부동산원지수 = 실제_예측_가격
 *
 *  ▷ 수식
 *    normalizedPrice(t) = rawPrice(t) / index(sigunguCode, ym(t))
 *    predictedPrice(t') = LSTM_output(t') × index(sigunguCode, now)
 *
 *  ▷ t_reb_price_index 미적재 시 fallback
 *    index = 100 (정규화 없음, 기존 동작 유지)
 *    → Day 1 seed:reb 완료 전까지 기존 추천 API 영향 없음
 *
 *  ▷ 사용처
 *    - recommendationRepository.ts: expectedReturn3y 보정
 *    - (미래) ML Python 파이프라인: 학습 데이터 전처리
 */
import { prisma } from '../db';

/**
 * 특정 시군구의 특정 월 지수를 DB 에서 조회.
 *  - 미적재 시 null 반환 (호출처가 100으로 fallback)
 *  - 성능: 인덱스 (sigungu_code + ym) 사용 — 즉각 응답
 */
export async function getIndexFromDb(
  sigunguCode: string,
  ym: string,  // "YYYY-MM"
): Promise<number | null> {
  const row = await prisma.rebPriceIndex.findUnique({
    where: { sigunguCode_ym: { sigunguCode, ym } },
    select: { indexValue: true },
  });
  return row?.indexValue ?? null;
}

/**
 * 가장 최근 적재된 지수 조회 (현재 시점 기준).
 *  - 지수가 당월 아직 미발표인 경우 전월 사용
 */
export async function getLatestIndex(sigunguCode: string): Promise<number | null> {
  const row = await prisma.rebPriceIndex.findFirst({
    where: { sigunguCode },
    orderBy: { ym: 'desc' },
    select: { indexValue: true, ym: true },
  });
  if (row) {
    console.debug(`[rebNormalize] 최신 지수: ${sigunguCode} ${row.ym} = ${row.indexValue}`);
  }
  return row?.indexValue ?? null;
}

/**
 * 실거래가 → 정규화값 변환.
 *
 *  normalizedPrice = rawPrice / (indexValue / 100)
 *    - indexValue = 102.5 → 분모 = 1.025
 *    - 지수 = 100(기준) 이면 정규화값 = rawPrice (변화 없음)
 *
 *  @param rawPrice   실거래가 (만원)
 *  @param indexValue R-ONE 지수값 (100 기준, 예: 102.5)
 *  @returns          정규화된 가격 (만원)
 */
export function normalizePrice(rawPrice: number, indexValue: number): number {
  const factor = indexValue / 100;
  if (factor <= 0) return rawPrice; // 방어
  return Math.round(rawPrice / factor);
}

/**
 * 정규화값 → 예측 실제가격 복원.
 *
 *  predictedPrice = lstmOutput × (currentIndex / 100)
 *
 *  @param lstmOutput   LSTM 이 예측한 정규화가격 (만원)
 *  @param currentIndex 현재 시점 R-ONE 지수값 (100 기준)
 *  @returns            실제 예측 가격 (만원)
 */
export function denormalizePrice(lstmOutput: number, currentIndex: number): number {
  const factor = currentIndex / 100;
  return Math.round(lstmOutput * factor);
}

/**
 * 행정동 수익률 보정 — expectedReturn3y 를 지수 기반으로 조정.
 *
 *  배경:
 *    현재 t_training_result.expected_return_3y 는 절대 가격 기반 학습 결과.
 *    R-ONE 지수가 적재된 후에는 정규화 학습으로 재학습해야 정확하지만,
 *    임시로 "시장 추세(지수 변화율)"를 차감한 상대 수익률로 보정.
 *
 *    보정 공식:
 *      adjustedReturn = rawReturn - marketTrend
 *      marketTrend    = (latestIndex - baseIndex) / baseIndex × 100
 *
 *    해석: 동 고유 알파(시장 대비 초과 수익) 추정.
 *
 *  @param rawReturn3y    기존 3년 누적 수익률 (%)
 *  @param sigunguCode    시군구코드 (5자리)
 *  @param baseYm         학습 기준 시점 ("YYYY-MM", 보통 3년 전)
 *  @returns              보정된 수익률 (%) — DB 없으면 rawReturn3y 그대로
 */
export async function adjustReturnByIndex(
  rawReturn3y: number,
  sigunguCode: string,
  baseYm: string,
): Promise<number> {
  const [baseIndex, latestIndex] = await Promise.all([
    getIndexFromDb(sigunguCode, baseYm),
    getLatestIndex(sigunguCode),
  ]);

  // 둘 중 하나라도 없으면 보정 불가 → 원본 반환
  if (baseIndex == null || latestIndex == null) return rawReturn3y;

  const marketTrend = ((latestIndex - baseIndex) / baseIndex) * 100;
  const adjusted = rawReturn3y - marketTrend;
  return Math.round(adjusted * 10) / 10;
}

/**
 * 배치 보정 — 여러 행정동의 수익률을 한 번에 보정.
 *  - 시군구별로 지수를 미리 로드해 DB 쿼리 최소화
 *
 *  @param items        { sigunguCode, rawReturn3y, baseYm }[]
 *  @returns            { sigunguCode, adjustedReturn }[]
 */
export async function batchAdjustReturns(
  items: Array<{ sigunguCode: string; rawReturn3y: number; baseYm: string }>,
): Promise<Map<string, number>> {
  if (items.length === 0) return new Map();

  // 고유 (sigunguCode, baseYm) 조합 → 지수 미리 조회
  const pairs = [...new Set(items.map((i) => `${i.sigunguCode}|${i.baseYm}`))];
  const baseIndexMap = new Map<string, number>();
  const latestIndexMap = new Map<string, number>();

  await Promise.all(
    pairs.map(async (pair) => {
      const [code, ym] = pair.split('|');
      const base = await getIndexFromDb(code, ym);
      const latest = await getLatestIndex(code);
      if (base != null)   baseIndexMap.set(pair, base);
      if (latest != null) latestIndexMap.set(code, latest);
    }),
  );

  const result = new Map<string, number>();
  for (const item of items) {
    const pair   = `${item.sigunguCode}|${item.baseYm}`;
    const base   = baseIndexMap.get(pair);
    const latest = latestIndexMap.get(item.sigunguCode);

    if (base == null || latest == null) {
      result.set(item.sigunguCode, item.rawReturn3y);
      continue;
    }

    const marketTrend = ((latest - base) / base) * 100;
    const adjusted    = Math.round((item.rawReturn3y - marketTrend) * 10) / 10;
    result.set(item.sigunguCode, adjusted);
  }

  return result;
}
