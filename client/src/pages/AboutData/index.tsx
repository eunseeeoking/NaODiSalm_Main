/**
 * /about/data — 4기관 공공데이터 융합 현황 페이지
 *  - 공모전 채점위원 + 일반 사용자 대상
 *  - GET /api/meta/data-sources 실시간 row 수 + 마지막 갱신일
 *  - 미응답 시 fallback (정적 카드 + 0 row 표시)
 *
 *  Phase 2-B (2026-05-27): 신설.
 *  - 가점 +5 (주관기관 데이터 융합) 가시화
 *  - 컨셉 전환(2026-05-22)의 "4기관 융합" 어필 정직 시각화
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export interface DataSourceMeta {
  id: 'molit-rtms' | 'reb-rone' | 'lh-youth' | 'safety-income';
  agency: string;
  agencyEn: string;
  name: string;
  description: string;
  rowCount: number;
  rowLabel: string;
  lastUpdated: string | null;
  apiUrl: string;
  tables: string[];
  badge?: string;
}

interface DataSourcesDto {
  asOf: string;
  sources: DataSourceMeta[];
  totalRows: number;
}

/** 서버 미응답 시 fallback (필드 모양만 맞춤) */
const FALLBACK: DataSourcesDto = {
  asOf: '서버 미응답',
  totalRows: 0,
  sources: [
    {
      id: 'molit-rtms',
      agency: '국토교통부',
      agencyEn: 'MOLIT',
      name: '아파트 실거래가 공개시스템 (RTMS)',
      description:
        '서울 25개 자치구 매매·전월세 실거래 내역. 단지 단위 현재가 + LSTM/ARIMA 시계열 학습의 원천 데이터.',
      rowCount: 0,
      rowLabel: '서버 미응답',
      lastUpdated: null,
      apiUrl: 'https://rt.molit.go.kr/',
      tables: ['t_apt_trade', 't_apt_rent', 't_apt_complex'],
      badge: '주관기관',
    },
    {
      id: 'reb-rone',
      agency: '한국부동산원',
      agencyEn: 'REB',
      name: 'R-ONE 부동산 통계정보 시스템',
      description: '시군구별 월간 공동주택 실거래가지수 — LSTM 정규화에 사용.',
      rowCount: 0,
      rowLabel: '서버 미응답',
      lastUpdated: null,
      apiUrl: 'https://www.reb.or.kr/r-one/',
      tables: ['t_reb_price_index'],
      badge: '주관기관 (가점 +5)',
    },
    {
      id: 'lh-youth',
      agency: '한국토지주택공사',
      agencyEn: 'LH',
      name: 'LH 임대주택단지 조회 서비스',
      description: '행복주택·청년매입임대·전세임대. Phase 2-B Kakao 지오코딩으로 행정동 정밀도 확보.',
      rowCount: 0,
      rowLabel: '서버 미응답',
      lastUpdated: null,
      apiUrl: 'https://www.data.go.kr/data/15059475/openapi.do',
      tables: ['t_lh_youth_housing'],
      badge: '청년 정책',
    },
    {
      id: 'safety-income',
      agency: '통계청 · 경찰청 · 서울시',
      agencyEn: 'KOSTAT+',
      name: '5분위 소득 · 안전 합성 지표',
      description: '가계금융복지조사 + 5대범죄·가로등·CCTV 합성. RIR + safety 축.',
      rowCount: 0,
      rowLabel: '서버 미응답',
      lastUpdated: null,
      apiUrl: 'https://kostat.go.kr/',
      tables: ['t_safety_index', 't_income_quintile'],
      badge: '사회 가치',
    },
  ],
};

/** 카드 톤 — id 마다 다른 좌측 보더 색 */
const TONE: Record<DataSourceMeta['id'], string> = {
  'molit-rtms':    'border-l-brand',
  'reb-rone':      'border-l-positive',
  'lh-youth':      'border-l-amber-500',
  'safety-income': 'border-l-purple-500',
};

export function AboutDataPage() {
  const [data, setData] = useState<DataSourcesDto>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/meta/data-sources', { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DataSourcesDto>;
      })
      .then((d) => {
        if (d && Array.isArray(d.sources) && d.sources.length > 0) {
          setData(d);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[AboutData] /api/meta/data-sources 실패:', err);
        setError(String(err));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  return (
    <div className="h-screen overflow-y-auto bg-surface dark:bg-surface-dark">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-surface dark:bg-surface-dark border-b border-line-light dark:border-line-dark">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <Link
            to="/"
            className="text-sm text-ink-secondary hover:text-ink-primary dark:text-ink-secondary-dark"
          >
            ← 나어디삶
          </Link>
          <span className="h-4 w-px bg-line-light dark:bg-line-dark" />
          <h1 className="text-base md:text-lg font-bold text-ink-primary dark:text-ink-primary-dark">
            데이터 출처
          </h1>
          {loading && (
            <span className="ml-auto text-2xs text-ink-tertiary tabular-nums">
              조회 중…
            </span>
          )}
          {!loading && !error && (
            <span className="ml-auto text-2xs text-ink-tertiary tabular-nums">
              {data.asOf} 기준
            </span>
          )}
          {error && (
            <span className="ml-auto text-2xs text-negative tabular-nums">
              서버 미응답 — 정적 표시
            </span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* 인트로 */}
        <section className="mb-8">
          <h2 className="text-xl md:text-2xl font-bold text-ink-primary dark:text-ink-primary-dark">
            공공데이터 4기관 융합
          </h2>
          <p className="mt-2 text-sm text-ink-secondary dark:text-ink-secondary-dark leading-relaxed">
            나어디삶은{' '}
            <strong className="text-ink-primary dark:text-ink-primary-dark">
              국토교통부 · 한국부동산원 · 한국토지주택공사 · 통계청
            </strong>{' '}
            4개 기관의 공공데이터를 융합해 청년·신혼부부의 주거 의사결정을 돕습니다.
            아래 수치는 서버 DB의 실시간 적재 현황입니다.
          </p>
          <p className="mt-2 text-xs text-ink-tertiary dark:text-ink-tertiary-dark">
            총 적재 row{' '}
            <span className="tabular-nums font-semibold text-ink-primary dark:text-ink-primary-dark">
              {data.totalRows.toLocaleString()}
            </span>
            건
          </p>
        </section>

        {/* 4기관 카드 */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {data.sources.map((src) => (
            <article
              key={src.id}
              className={`rounded-cardlg border border-line-light dark:border-line-dark border-l-4 ${TONE[src.id]} bg-surface-elevated dark:bg-surface-dark-elevated p-4 md:p-5 flex flex-col gap-2`}
            >
              <header className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-ink-tertiary tabular-nums">
                      {src.agencyEn}
                    </span>
                    <span className="text-xs text-ink-tertiary">·</span>
                    <span className="text-xs font-semibold text-ink-secondary dark:text-ink-secondary-dark">
                      {src.agency}
                    </span>
                    {src.badge && (
                      <span className="ml-1 text-2xs font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                        {src.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-base md:text-lg font-bold text-ink-primary dark:text-ink-primary-dark leading-tight">
                    {src.name}
                  </h3>
                </div>
              </header>

              <p className="text-xs text-ink-secondary dark:text-ink-secondary-dark leading-relaxed">
                {src.description}
              </p>

              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-ink-tertiary">적재 현황</dt>
                <dd className="text-ink-primary dark:text-ink-primary-dark font-semibold tabular-nums text-right">
                  {src.rowLabel}
                </dd>
                <dt className="text-ink-tertiary">마지막 갱신</dt>
                <dd className="text-ink-primary dark:text-ink-primary-dark tabular-nums text-right">
                  {src.lastUpdated ?? '미적재'}
                </dd>
                <dt className="text-ink-tertiary">DB 테이블</dt>
                <dd className="text-ink-secondary dark:text-ink-secondary-dark font-mono text-2xs text-right break-all">
                  {src.tables.join(', ')}
                </dd>
              </dl>

              <footer className="mt-2 pt-2 border-t border-line-light dark:border-line-dark">
                <a
                  href={src.apiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand hover:underline tabular-nums"
                >
                  공식 사이트 / API 명세 →
                </a>
              </footer>
            </article>
          ))}
        </section>

        {/* 푸터 */}
        <section className="mt-8 pt-6 border-t border-line-light dark:border-line-dark text-xs text-ink-tertiary dark:text-ink-tertiary-dark leading-relaxed">
          <p>
            본 화면의 row 수는{' '}
            <code className="font-mono">GET /api/meta/data-sources</code> 응답을
            그대로 표시합니다. 응답이 비거나 실패하면 정적 fallback 으로 표시되며,
            응답 헤더의 <code className="font-mono">asOf</code> 가 KST 기준 마지막
            집계 시점입니다.
          </p>
          <p className="mt-2">
            데이터셋은 모두 공공데이터포털(data.go.kr) 또는 주관기관 공식 API를 통해
            제공받으며, 인증키는 서버 환경변수로만 보관합니다.
          </p>
        </section>
      </main>
    </div>
  );
}

export default AboutDataPage;
