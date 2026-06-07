/**
 * 가격 흐름 정성 라벨 — 카드(ComplexCardList)·상세 패널(PriceStabilityAnalysis) 공통 소스.
 *
 *  ▷ "N년 +N%" 같은 수익률 숫자는 청년 주거 타깃에서 투자 장려 컨텐츠로 비칠 위험이 있어
 *    방향성 정성 문구로 통일(컨셉 전환 2026-05-24, 차트 정직화 2026-06-06).
 *  ▷ 한 곳에만 두어 카드와 상세 패널의 문구가 어긋나지 않도록 단일 출처로 유지.
 *
 *  입력 ret3y = 3년 가격 변동률(%) (상세 패널: expectedReturn3y, 카드: 예측3년/현재 단가 변동).
 */
export function trendLabel(ret3y: number): { label: string; hint: string } {
  if (ret3y >= 5) return { label: '완만한 상승세', hint: '최근 실거래 추세 기준' };
  if (ret3y > -5) return { label: '안정적', hint: '큰 변동 없음' };
  if (ret3y > -15) return { label: '완만한 약세', hint: '매매 시 가격 협상 여지' };
  return { label: '약세 추세', hint: '협상 여지 · 추정 불확실' };
}
