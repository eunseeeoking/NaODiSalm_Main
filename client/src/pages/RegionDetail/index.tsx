/**
 * Depth 3 · 지역 상세 페이지
 *  - 경로: /region/:legalDongCode
 *
 *  레이아웃 (토스 한국형 톤)
 *  ┌──────────────────────────────────────────────────┐
 *  │  RegionDetailHeader  (지역명 + 점수 + 뒤로가기)     │
 *  ├──────────────────┬───────────────────────────────┤
 *  │                  │                                │
 *  │  RegionMiniMap   │  ComplexCardList               │
 *  │  (해당 행정동 +    │  (단지 카드 N개)                 │
 *  │  단지 핀 +         │   → 카드 클릭 시                  │
 *  │  직장 마커)         │      LstmFullAnalysis 모달 오픈   │
 *  │                  │                                │
 *  └──────────────────┴───────────────────────────────┘
 *
 *  ※ 실제 API 도착 전까지 mock 데이터 사용
 *  ※ 직장이 없는 상태로 진입 시 → 메인으로 리다이렉트
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecommendationStore } from '../../stores/useRecommendationStore';
import { MOCK_REGIONS } from '../Recommendation/data/mockRegions';
import { getMockComplexesForRegion } from './data/mockComplexes';
import { getMockLstm } from './data/mockLstmResults';
import { getMockCommuteCompare } from './data/mockCommuteCompare';
import { RegionDetailHeader } from './components/RegionDetailHeader';
import { RegionMiniMap } from './components/RegionMiniMap';
import { ComplexCardList } from './components/ComplexCardList';
import { LstmFullAnalysis } from './components/LstmFullAnalysis';
import { CommuteCompare } from './components/CommuteCompare';
import type { AptComplex } from '../../types/region-detail';

export function RegionDetailPage() {
  const { legalDongCode = '' } = useParams<{ legalDongCode: string }>();
  const navigate = useNavigate();
  const workplace = useRecommendationStore((s) => s.workplace);

  /** 현재 지역 메타 (Depth 2 추천 결과 또는 mock에서 조회) */
  const region = useMemo(
    () => MOCK_REGIONS.find((r) => r.legalDongCode === legalDongCode) ?? null,
    [legalDongCode],
  );

  /** 매물 카드 리스트 */
  const complexes = useMemo<AptComplex[]>(
    () => getMockComplexesForRegion(legalDongCode),
    [legalDongCode],
  );

  /** 현재 선택된 단지 (LSTM 분석 모달 노출 대상) */
  const [selectedComplex, setSelectedComplex] = useState<AptComplex | null>(null);

  /** 첫 단지 자동 선택 — 비어있는 우측 화면 방지 */
  useEffect(() => {
    if (!selectedComplex && complexes.length > 0) {
      setSelectedComplex(complexes[0]);
    }
  }, [complexes, selectedComplex]);

  // 잘못된 경로 또는 직접 URL 진입 → 메인으로
  if (!region) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-surface dark:bg-surface-dark text-ink-primary dark:text-ink-primary-dark font-sans gap-4">
        <p className="text-sm text-ink-secondary dark:text-ink-secondary-dark">
          존재하지 않는 지역입니다.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-card bg-brand text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
        >
          추천 페이지로 돌아가기
        </button>
      </div>
    );
  }

  const lstm = selectedComplex ? getMockLstm(selectedComplex.complexId) : null;
  const commute = selectedComplex
    ? getMockCommuteCompare(selectedComplex.complexId, workplace)
    : null;

  return (
    <div className="w-screen h-screen flex flex-col bg-surface dark:bg-surface-dark overflow-hidden text-ink-primary dark:text-ink-primary-dark font-sans">
      <RegionDetailHeader region={region} onBack={() => navigate('/')} />

      <main className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden">
        {/* 좌: 미니 지도 (4컬) */}
        <section className="col-span-4 rounded-cardlg overflow-hidden bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card">
          <RegionMiniMap
            region={region}
            complexes={complexes}
            workplace={workplace}
            selectedComplexId={selectedComplex?.complexId ?? null}
            onSelectComplex={(c) => setSelectedComplex(c)}
          />
        </section>

        {/* 우: 매물 + LSTM (8컬) */}
        <section className="col-span-8 flex flex-col gap-3 overflow-hidden">
          {/* 매물 카드 리스트 (가로 스크롤) */}
          <ComplexCardList
            complexes={complexes}
            selectedId={selectedComplex?.complexId ?? null}
            onSelect={setSelectedComplex}
          />

          {/* LSTM 분석 + 통근 비교 */}
          <div className="flex-1 grid grid-cols-3 gap-3 overflow-hidden">
            <div className="col-span-2 overflow-auto">
              {selectedComplex && lstm ? (
                <LstmFullAnalysis complex={selectedComplex} lstm={lstm} />
              ) : (
                <EmptyAnalysis />
              )}
            </div>
            <div className="col-span-1 overflow-auto">
              {commute ? (
                <CommuteCompare data={commute} />
              ) : (
                <EmptyCommute />
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function EmptyAnalysis() {
  return (
    <div className="h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
      좌측 매물을 선택해 주세요.
    </div>
  );
}

function EmptyCommute() {
  return (
    <div className="h-full rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card flex items-center justify-center text-xs text-ink-tertiary dark:text-ink-tertiary-dark text-center px-3">
      직장이 설정되어야
      <br />
      통근 비교가 표시됩니다.
    </div>
  );
}
