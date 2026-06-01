/**
 * 좌측 오버레이 패널 — 4개 접이식 섹션 아코디언 (2026-05-30 P3 후속)
 *   1) 통근·예산        CommutePatienceSlider
 *   2) 거래유형          DealTypeToggle
 *   3) 매물종류          PropertyTypeFilter
 *   4) 가중치·소득분위    WeightSliders
 *
 *  각 섹션 독립 토글 — 접으면 아이콘 + 라벨 헤더만 남아 작게.
 *  전체는 스크롤 영역(섹션 펼침 조합이 길어도 패널 안에서 스크롤).
 */
import { useState } from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { CommutePatienceSlider } from './CommutePatienceSlider';
import { WeightSliders } from './WeightSliders';
import { DealTypeToggle } from './DealTypeToggle';
import { PropertyTypeFilter } from './PropertyTypeFilter';

/* ── 섹션 아이콘 (인라인 SVG, 16px) ───────────────────────────── */
const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const CommuteIcon = (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const DealIcon = (
  <svg {...iconProps}>
    <path d="M7 17V4m0 0L3.5 7.5M7 4l3.5 3.5" />
    <path d="M17 7v13m0 0 3.5-3.5M17 20l-3.5-3.5" />
  </svg>
);
const PropertyIcon = (
  <svg {...iconProps}>
    <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
  </svg>
);
const WeightIcon = (
  <svg {...iconProps}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </svg>
);

type SectionKey = 'commute' | 'deal' | 'property' | 'weight';

export function LeftPanel() {
  // 한 번에 하나만 열림 — 같은 섹션 재클릭 시 닫힘(null)
  const [openKey, setOpenKey] = useState<SectionKey | null>('commute');
  const toggle = (key: SectionKey) =>
    setOpenKey((cur) => (cur === key ? null : key));

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto min-h-0 pb-1 flex flex-col gap-2.5">
        <CollapsibleSection
          icon={CommuteIcon}
          title="통근·예산"
          open={openKey === 'commute'}
          onToggle={() => toggle('commute')}
        >
          <CommutePatienceSlider bare />
        </CollapsibleSection>

        <CollapsibleSection
          icon={DealIcon}
          title="거래유형"
          tooltip="주거비 부담 점수의 기준이 됩니다. 전세·월세는 국토부 실거래 전월세 시세, 매매는 매매가 환산을 사용합니다."
          open={openKey === 'deal'}
          onToggle={() => toggle('deal')}
        >
          <DealTypeToggle bare />
        </CollapsibleSection>

        <CollapsibleSection
          icon={PropertyIcon}
          title="매물종류"
          tooltip="전월세 시세를 고른 매물종류만으로 집계합니다. 아파트와 빌라·단독을 섞으면 동 시세가 왜곡되므로, 실제로 찾는 종류만 선택하세요."
          open={openKey === 'property'}
          onToggle={() => toggle('property')}
        >
          <PropertyTypeFilter bare />
        </CollapsibleSection>

        <CollapsibleSection
          icon={WeightIcon}
          title="가중치·소득분위"
          tooltip="4개 축의 중요도 비율과 소득 수준을 설정합니다. 합계가 90~110이 되도록 조정하세요."
          open={openKey === 'weight'}
          onToggle={() => toggle('weight')}
        >
          <WeightSliders bare />
        </CollapsibleSection>
      </div>
    </div>
  );
}
