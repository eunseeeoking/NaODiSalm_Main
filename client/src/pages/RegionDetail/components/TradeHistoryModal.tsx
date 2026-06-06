/**
 * 실제 거래 내역 모달 (Depth 3)
 *  - 국토부 실거래가 원본을 최근순으로 표시 (예측 아님 — ground truth).
 *  - 면적·층을 함께 보여줘 "가격 편차의 이유"를 사용자가 스스로 이해(선택 도우미).
 *  - 모델을 못 믿어도 원본 데이터는 반박 불가 → 신뢰의 근거를 데이터로 이전.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchComplexTrades } from '../../../api/regionDetail';
import type { ComplexTrade } from '../../../types/region-detail';

interface Props {
  complexId: string;
  complexName: string;
  onClose: () => void;
}

const PYEONG = 3.3058; // 1평 = 3.3058㎡

export function TradeHistoryModal({ complexId, complexName, onClose }: Props) {
  const [trades, setTrades] = useState<ComplexTrade[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchComplexTrades(complexId, 100, ctrl.signal)
      .then((r) => setTrades(r.trades))
      .catch((e) => {
        if (!(e instanceof DOMException)) setError(true);
      });
    return () => ctrl.abort();
  }, [complexId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const period =
    trades && trades.length > 0
      ? `${trades[trades.length - 1].ym} ~ ${trades[0].ym}`
      : '';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${complexName} 실제 거래 내역`}
    >
      <div
        className="w-full md:max-w-lg max-h-[80vh] flex flex-col rounded-t-cardlg md:rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-line-light dark:border-line-dark">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink-primary dark:text-ink-primary-dark truncate">
              실제 거래 내역
            </h3>
            <p className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark mt-0.5 truncate">
              {complexName}
              {trades ? ` · 최근 ${trades.length}건${period ? ` · ${period}` : ''}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-ink-tertiary hover:text-ink-primary dark:hover:text-ink-primary-dark text-xl leading-none px-1"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
              거래 내역을 불러오지 못했어요.
            </p>
          )}
          {!error && trades === null && (
            <p className="p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
              불러오는 중…
            </p>
          )}
          {!error && trades && trades.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-tertiary dark:text-ink-tertiary-dark">
              이 단지는 실거래 기록이 없어요.
            </p>
          )}
          {!error && trades && trades.length > 0 && (
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-surface-elevated dark:bg-surface-dark-elevated text-ink-tertiary dark:text-ink-tertiary-dark">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">거래월</th>
                  <th className="px-3 py-2 font-medium">면적</th>
                  <th className="px-3 py-2 font-medium">층</th>
                  <th className="px-3 py-2 font-medium text-right">거래가</th>
                  <th className="px-3 py-2 font-medium text-right">m²당</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr
                    key={`${t.dealDate}-${i}`}
                    className="border-t border-line-light/60 dark:border-line-dark/60 text-ink-secondary dark:text-ink-secondary-dark"
                  >
                    <td className="px-3 py-2">{t.ym}</td>
                    <td className="px-3 py-2">
                      {t.areaM2.toFixed(1)}㎡
                      <span className="text-ink-tertiary dark:text-ink-tertiary-dark">
                        {' '}
                        ({Math.round(t.areaM2 / PYEONG)}평)
                      </span>
                    </td>
                    <td className="px-3 py-2">{t.floor != null ? `${t.floor}층` : '-'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink-primary dark:text-ink-primary-dark">
                      {(t.priceManwon / 10000).toFixed(1)}억
                    </td>
                    <td className="px-3 py-2 text-right">{t.pricePerM2.toLocaleString()}만</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 — 정직 톤 */}
        <p className="p-3 text-2xs text-ink-tertiary dark:text-ink-tertiary-dark border-t border-line-light dark:border-line-dark leading-relaxed">
          국토부 실거래가 원본 (최근순). 면적·층에 따라 가격이 다릅니다. 실제 매물은 별도 확인하세요.
        </p>
      </div>
    </div>,
    document.body,
  );
}
