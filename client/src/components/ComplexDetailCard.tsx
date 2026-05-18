import { useEffect, useState } from 'react';
import {
  fetchComplexDetail,
  type ComplexDetail,
  type ComplexMarker,
} from '../api/realty';
import { ApiError } from '../api/client';

interface Props {
  marker: ComplexMarker;
  onClose: () => void;
}

function manwonToEok(manwon: number): string {
  return (manwon / 10000).toFixed(2);
}

function manwonToText(manwon: number): string {
  // 12000 -> "1.2억" / 8500 -> "8,500만"
  if (manwon >= 10000) return `${(manwon / 10000).toFixed(2)}억`;
  return `${manwon.toLocaleString()}만`;
}

export function ComplexDetailCard({ marker, onClose }: Props) {
  const [detail, setDetail] = useState<ComplexDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchComplexDetail(marker.id)
      .then(setDetail)
      .catch((e) => {
        if (e instanceof ApiError) setError(e.message);
        else setError(e instanceof Error ? e.message : '에러');
      })
      .finally(() => setLoading(false));
  }, [marker.id]);

  return (
    <aside className="detail-card">
      <header className="detail-header">
        <div>
          <h2>{marker.name}</h2>
          <p className="detail-sub">
            {marker.legalDong}
            {marker.builtYear ? ` · ${marker.builtYear}년 준공` : ''}
          </p>
        </div>
        <button type="button" className="close-btn" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>

      <section className="detail-summary">
        <div className="summary-item">
          <div className="summary-label">최근 매매가</div>
          <div className="summary-value">
            {marker.lastTradePriceManwon
              ? `${manwonToEok(marker.lastTradePriceManwon)}억`
              : '-'}
          </div>
          <div className="summary-sub">
            {marker.lastTradeDate
              ? new Date(marker.lastTradeDate).toLocaleDateString()
              : '거래 이력 없음'}
          </div>
        </div>
        <div className="summary-item">
          <div className="summary-label">최근 12개월</div>
          <div className="summary-value">{marker.tradeCount12m}건</div>
          <div className="summary-sub">매매 거래</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">전월세</div>
          <div className="summary-value">{marker.rentCount12m}건</div>
          <div className="summary-sub">12개월</div>
        </div>
      </section>

      {loading && <p className="detail-loading">로딩 중...</p>}
      {error && <p className="error">에러: {error}</p>}

      {detail && (
        <>
          <section className="detail-section">
            <h3>최근 매매 ({detail.recentTrades.length})</h3>
            {detail.recentTrades.length === 0 ? (
              <p className="muted">이력 없음</p>
            ) : (
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>가격</th>
                    <th>면적</th>
                    <th>층</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentTrades.map((t, i) => (
                    <tr key={i}>
                      <td>{new Date(t.dealDate).toLocaleDateString()}</td>
                      <td>{manwonToText(t.priceManwon)}</td>
                      <td>{t.areaM2.toFixed(1)}㎡</td>
                      <td>{t.floor ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="detail-section">
            <h3>최근 전월세 ({detail.recentRents.length})</h3>
            {detail.recentRents.length === 0 ? (
              <p className="muted">이력 없음</p>
            ) : (
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>구분</th>
                    <th>보증금</th>
                    <th>월세</th>
                    <th>면적</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentRents.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.contractDate).toLocaleDateString()}</td>
                      <td>{r.contractType === 'JEONSE' ? '전세' : '월세'}</td>
                      <td>{manwonToText(r.depositManwon)}</td>
                      <td>{r.monthlyManwon > 0 ? `${r.monthlyManwon}만` : '-'}</td>
                      <td>{r.areaM2.toFixed(1)}㎡</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
