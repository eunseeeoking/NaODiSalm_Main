/**
 * 추천 지역 카드
 *  - 호버 시 hoveredRegion 스토어 갱신 → 지도 폴리곤 외곽선 강조
 *  - 1위 카드만 강조 (2px 보더 + 4축 막대 표시)
 *  - 2~8위는 컴팩트
 */
import { useRecommendationStore } from '../../../stores/useRecommendationStore';
import type { RegionRecommendation } from '../../../types/recommendation';

interface Props {
  region: RegionRecommendation;
  rank: number;
}

function formatEok(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const remainder = Math.round((manwon % 10000) / 1000);
  if (remainder === 0) return `${eok}억`;
  return `${eok}.${remainder}억`;
}

export function RegionCard({ region, rank }: Props) {
  const hoveredRegion = useRecommendationStore((s) => s.hoveredRegion);
  const setHovered = useRecommendationStore((s) => s.setHovered);
  const isHovered = hoveredRegion === region.legalDongCode;
  const isTop = rank === 1;

  const cls = [
    'bg-white rounded-card p-3 transition-all cursor-pointer',
    isTop ? 'border-2 border-info-border' : 'border border-gray-200 hover:border-gray-300',
    isHovered && !isTop ? 'ring-1 ring-info-border' : '',
  ].join(' ');

  return (
    <div
      onMouseEnter={() => setHovered(region.legalDongCode)}
      onMouseLeave={() => setHovered(null)}
      className={cls}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className={[
              'text-[10px] px-1.5 py-0.5 rounded shrink-0',
              isTop ? 'bg-info-bg text-info-fg font-medium' : 'bg-gray-100 text-gray-600',
            ].join(' ')}
          >
            {rank}위
          </span>
          <span className="text-[13px] font-medium truncate">{region.displayName}</span>
        </div>
        <span className="text-lg font-medium shrink-0 ml-2">
          {region.totalScore}
          <span className="text-[10px] text-gray-500 font-normal">점</span>
        </span>
      </div>

      <div className="flex gap-2.5 text-[11px] text-gray-500 mb-2">
        <span>🚇 {region.commuteMinutes}분</span>
        <span>💰 {formatEok(region.representativePrice)}</span>
        <span>📈 {region.expectedReturn3y > 0 ? '+' : ''}{region.expectedReturn3y}%</span>
      </div>

      {isTop && (
        <div className="grid grid-cols-4 gap-1 text-[9px]">
          {[
            { label: '통근',   value: region.commuteScore },
            { label: '가성비', value: region.valueScore },
            { label: '투자',   value: region.investmentScore },
            { label: '생활',   value: region.lifeScore },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-gray-500 mb-0.5">{m.label}</div>
              <div className="h-[3px] bg-gray-100 rounded overflow-hidden">
                <div className="h-full bg-info-border" style={{ width: `${m.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
