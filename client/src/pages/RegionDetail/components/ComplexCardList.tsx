/**
 * 매물 단지 카드 가로 스크롤 리스트 (APT 매매 전용)
 *  - 선택 단지 강조
 *  - 단지명 / 평형·연식 / 거래가 / 3년 가격 변동성
 *
 *  Phase 1.5 (2026-05-27 revert)
 *  - LH 카드/필터는 제거 — LH 데이터는 단지 디테일이 없어 시군구 집계로만 신뢰 가능
 *  - LH 집계는 별도 컴포넌트 <LhAggregateBanner> 가 상단에서 처리
 *  - propertyKind 필드는 유지 (Phase 3 의 VILLA/OFFICETEL 분기에 재사용)
 */
import { useDragScroll } from '../../../hooks/useDragScroll';
import type { AptComplex } from '../../../types/region-detail';

interface Props {
  complexes: AptComplex[];
  selectedId: string | null;
  onSelect: (complex: AptComplex) => void;
}

function formatEok(manwon: number): string {
  const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
  return `${eok}억`;
}

export function ComplexCardList({ complexes, selectedId, onSelect }: Props) {
  // 훅은 early return 보다 먼저 (Rules of Hooks)
  const cardScrollRef = useDragScroll<HTMLDivElement>();

  if (complexes.length === 0) {
    return (
      <div className="shrink-0 h-32 rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
        등록된 단지가 없습니다.
      </div>
    );
  }

  return (
    // min-w-0: flex 컨테이너 안에서 내부 가로 스크롤이 정상 동작하도록 폭 제약(스와이퍼 복구)
    <div className="shrink-0 min-w-0">
      {/* 헤더: 제목 + 매매 참고용 명시 */}
      <div className="mb-2 px-1">
        <h2 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          매물 단지
          <span className="ml-2 text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            {complexes.length}건
          </span>
        </h2>
        {/* 단지 카드는 거래유형과 무관하게 아파트 '매매' 실거래·전망 — 혼동 방지 명시(KI-18) */}
        <p className="mt-0.5 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
          아파트 <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark">매매</span> 실거래 기준 · 참고용 (전월세로 조회해도 단지 시세·전망은 매매가)
        </p>
      </div>

      {/* overflow-x-auto 는 세로축도 auto 로 클립 → 선택 카드의 border-2(2px)가 잘리지 않도록 사방 소폭 패딩.
          그림자 제거 후 음수 마진 트릭 불필요(좌측 첫 카드 보더 짤림 원인) → 대칭 px/py 로 단순화. */}
      <div ref={cardScrollRef} className="overflow-x-auto scroll-x-slider px-1 py-1">
        <div className="flex gap-2.5 min-w-min">
          {complexes.map((c) => {
            const isSelected = c.complexId === selectedId;

            return (
              <button
                key={c.complexId}
                onClick={() => onSelect(c)}
                className={[
                  'shrink-0 w-56 rounded-cardlg p-3 text-left transition-colors',
                  'bg-surface-elevated dark:bg-surface-dark-elevated',
                  // 보더만 — 그림자/헤일로/lift 없음. 선택 = 파란 2px, 미선택 = 중립 1px + hover 보더 강조
                  isSelected
                    ? 'border-2 border-brand'
                    : 'border border-line-light dark:border-line-dark hover:border-ink-tertiary dark:hover:border-ink-tertiary-dark',
                ].join(' ')}
              >
                {/* 단지명 */}
                <div className="flex items-start gap-1.5 mb-1">
                  <span className="text-sm font-semibold text-ink-primary dark:text-ink-primary-dark truncate flex-1">
                    {c.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark">
                    {c.sizeBucket}
                  </span>
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface dark:bg-surface-dark-elevated-hover text-ink-secondary dark:text-ink-secondary-dark">
                    {c.ageBucket}
                  </span>
                  <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
                    {c.builtYear}년
                  </span>
                </div>
                {/* 매매가 + 전용면적. 3년 변동 %(수익률 오인)·추세 라벨은 제거(동 균일 배수라 신뢰 불가,
                    진짜 가격 흐름은 카드 선택 시 ARIMA 패널). 우측엔 단지별로 실재하는 전용면적만 노출 —
                    신뢰도(전 단지 50 균일)·세대수(t_apt_complex 미보유로 0 고정)는 의미 없어 표기 안 함. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-bold text-ink-primary dark:text-ink-primary-dark tabular-nums tracking-tight">
                    {formatEok(c.recentPrice)}
                  </span>
                  <span className="text-xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums shrink-0">
                    전용 {c.exclusiveArea}㎡
                  </span>
                </div>
                <div className="mt-1.5 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
                  m²당 {c.pricePerM2.toLocaleString()}만
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-1.5 px-1 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        카드를 선택하면 가격 안정성 분석이 표시돼요
      </p>

      {/* 데이터 출처 footer — 공공데이터 융합 (6개 공공기관 + 민간 API) */}
      <div className="mt-2 px-1 flex items-center gap-2 flex-wrap text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark shrink-0">데이터</span>
        <span>국토부 RTMS {complexes.length > 0 ? `· ${complexes.length}단지` : ''}</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>한국부동산원 R-ONE</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>ARIMA 통계 모델</span>
      </div>
    </div>
  );
}
