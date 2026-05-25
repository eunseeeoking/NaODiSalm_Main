/**
 * 좌측 오버레이 패널 — 통근 인내심 슬라이더 + 가중치 슬라이더
 *
 *  CommutePatienceSlider: 상단 고정 (스크롤 밖)
 *  WeightSliders:        스크롤 영역 (내용이 길면 패널 안에서 스크롤)
 *
 *  overflow 설계:
 *    루트 div → h-full flex flex-col (높이 고정)
 *    스크롤 영역 → flex-1 overflow-y-auto min-h-0
 *    InfoTooltip → position="top" 사용으로 수평 클리핑 방지
 */
import { CommutePatienceSlider } from './CommutePatienceSlider';
import { WeightSliders } from './WeightSliders';

export function LeftPanel() {
  return (
    <div className="h-full flex flex-col gap-3">
      {/* 통근 인내심 — 항상 상단 고정 */}
      <CommutePatienceSlider />

      {/* 가중치 — 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-1">
        <WeightSliders />
      </div>
    </div>
  );
}
