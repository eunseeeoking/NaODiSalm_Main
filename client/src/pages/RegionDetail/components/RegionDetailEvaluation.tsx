/**
 * Depth 3 · "동 상세 평가" 패널 (KI-18 공통 코어)
 *
 *  매물종류 무관 공통 화면 — 설계 docs/depth3-design.md §3-A.
 *   (A) 4축 점수 근거 분해: 통근(교통 품질) / 주거비(RIR) / 안전(범죄·가로등·CCTV) / 생활(POI)
 *   (B) 시세 구조: 매매/전세/월세 median + 표본 N (예측이 아니라 "분포")
 *
 *  ▷ 데이터 출처 분리:
 *    - 가중 4축 점수(commuteScore 등)·RIR·월주거비 = store 추천(RegionRecommendation, 사용자 입력 의존)
 *    - 세부 분해(안전 3종·POI 8종·교통 품질)·시세 median = GET /detail(RegionDetail, 객관 데이터)
 *  ▷ 비아파트(APT 미선택)는 시계열 전망 부적합 → 정직 안내(설계 §2-3, §3-B).
 *  ▷ 미적재 축(시드 전·표본 부족)은 detail 이 null → "미집계" 표기.
 */
import type {
  RegionRecommendation,
  RecDealType,
  RecPropertyType,
} from '../../../types/recommendation';
import { PROPERTY_TYPE_LABELS } from '../../../types/recommendation';
import type { RegionDetail, AxisLife, CommuteCompareData, AreaTierPrice } from '../../../types/region-detail';
import { InfoTooltip } from '../../../components/InfoTooltip';

interface Props {
  region: RegionRecommendation;
  detail: RegionDetail | null;
  /** 사용자가 추천에서 고른 거래유형 — 시세 구조에서 해당 행 강조 */
  dealType: RecDealType;
  /** 사용자가 고른 매물종류 — 정직 안내(비아파트) 분기 */
  propertyTypes: RecPropertyType[];
  /** 동 centroid → 직장 통근 비교 (자차/대중교통). null = 직장 미설정/실패 */
  commute?: CommuteCompareData | null;
  /** 직장 설정 여부 — 통근 표시 분기 */
  hasWorkplace?: boolean;
  loading?: boolean;
}

// ─── 포맷 헬퍼 ────────────────────────────────────────────────
function fmtEok(manwon: number): string {
  if (manwon >= 10000) {
    const eok = (manwon / 10000).toFixed(1).replace(/\.0$/, '');
    return `${eok}억`;
  }
  return `${Math.round(manwon).toLocaleString()}만`;
}

function tierColor(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-400';
  if (score >= 25) return 'bg-orange-400';
  return 'bg-rose-400';
}

// ─── 0~100 점수 막대 ──────────────────────────────────────────
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="h-1.5 w-full rounded-full bg-line-light dark:bg-line-dark overflow-hidden">
      <div className={`h-full rounded-full ${tierColor(pct)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── 축 카드 (제목 + 가중점수 + 분해) ──────────────────────────
function AxisCard({
  title,
  score,
  estimated,
  children,
}: {
  title: string;
  score: number;
  estimated?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-card bg-surface dark:bg-surface-dark-elevated-hover p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-ink-primary dark:text-ink-primary-dark">{title}</span>
        <span className="text-xs font-bold tabular-nums text-ink-secondary dark:text-ink-secondary-dark">
          {estimated ? '추정' : Math.round(score)}
          {!estimated && <span className="text-2xs font-medium text-ink-tertiary">/100</span>}
        </span>
      </div>
      <ScoreBar score={estimated ? 0 : score} />
      {estimated && (
        <p className="mt-1 text-2xs text-amber-600 dark:text-amber-400">데이터 미적재 · 점수 미반영</p>
      )}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ─── 표본 칩 (KI-11) ──────────────────────────────────────────
function SampleChip({ n }: { n: number }) {
  const low = n < 10;
  return (
    <span
      className={[
        'text-2xs font-medium px-1.5 py-0.5 rounded tabular-nums',
        low
          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
          : 'bg-surface-elevated dark:bg-surface-dark-elevated text-ink-tertiary dark:text-ink-tertiary-dark',
      ].join(' ')}
    >
      표본 {n}건{low ? ' · 참고' : ''}
    </span>
  );
}

// ─── POI 카테고리 그리드 ──────────────────────────────────────
const POI_CATS: { key: keyof AxisLife; label: string }[] = [
  { key: 'subwayCount', label: '지하철' },
  { key: 'martCount', label: '마트' },
  { key: 'convenienceCount', label: '편의점' },
  { key: 'cafeCount', label: '카페' },
  { key: 'restaurantCount', label: '음식점' },
  { key: 'hospitalCount', label: '병원' },
  { key: 'pharmacyCount', label: '약국' },
  { key: 'bankCount', label: '은행' },
];

export function RegionDetailEvaluation({ region, detail, dealType, propertyTypes, commute, hasWorkplace, loading }: Props) {
  const estimated = new Set(region.estimatedAxes ?? []);
  const isAptOnly = propertyTypes.length === 1 && propertyTypes[0] === 'APT';
  const includesApt = propertyTypes.includes('APT');
  const typeLabels = propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t]).join('·');

  const price = detail?.price;
  const transit = detail?.transit;
  const safety = detail?.safety;
  const life = detail?.life;

  return (
    <div className="rounded-cardlg bg-surface-elevated dark:bg-surface-dark-elevated border border-line-light dark:border-line-dark shadow-card p-3 flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-ink-primary dark:text-ink-primary-dark">
          동 상세 평가
          <span className="ml-2 text-2xs font-medium text-ink-tertiary dark:text-ink-tertiary-dark">
            {region.dong}
          </span>
        </h2>
        {typeof detail?.complexCount === 'number' && detail.complexCount > 0 && (
          <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums">
            단지 {detail.complexCount.toLocaleString()}
          </span>
        )}
      </div>

      {/* 비아파트 정직 안내 (설계 §2-3) */}
      {!isAptOnly && (
        <p className="text-2xs leading-relaxed text-ink-tertiary dark:text-ink-tertiary-dark bg-surface dark:bg-surface-dark-elevated-hover rounded-card px-2.5 py-2">
          {includesApt ? (
            <>아파트 외 매물({typeLabels})은 매물 단위 시세 예측이 어려워, 동 시세 <b>분포</b>와 4축 평가로 안내해요.</>
          ) : (
            <>{typeLabels}은 매물·단지 단위 가격 예측이 부적합(식별이 동 단위·표본 부족)해, 시계열 전망 대신 동 시세 <b>분포</b>와 4축 상세 평가를 제공해요.</>
          )}
        </p>
      )}

      {loading && (
        <p className="text-xs text-ink-tertiary dark:text-ink-tertiary-dark">상세 데이터 불러오는 중…</p>
      )}

      {/* (B) 시세 구조 */}
      <div>
        <h3 className="text-xs font-bold text-ink-secondary dark:text-ink-secondary-dark mb-1.5">시세 (최근 1년 중위값)</h3>
        {price && (price.sale || price.jeonse || price.monthly) ? (
          <div className="flex flex-col gap-1.5">
            {price.sale && (
              <PriceRow label="매매" highlight={dealType === 'SALE'}>
                <span className="font-bold tabular-nums">{fmtEok(price.sale.medianManwon)}</span>
              </PriceRow>
            )}
            {price.jeonse && (
              <PriceRow label="전세" highlight={dealType === 'JEONSE'} chip={<SampleChip n={price.jeonse.sampleCount} />}>
                <span className="font-bold tabular-nums">보증금 {fmtEok(price.jeonse.depositMedianManwon)}</span>
              </PriceRow>
            )}
            {price.monthly && (
              <PriceRow label="월세" highlight={dealType === 'MONTHLY'} chip={<SampleChip n={price.monthly.sampleCount} />}>
                <span className="font-bold tabular-nums">
                  월 {price.monthly.pureMonthlyMedianManwon}만
                </span>
                <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark tabular-nums ml-1.5">
                  보증금 {fmtEok(price.monthly.depositMedianManwon)}
                </span>
              </PriceRow>
            )}
          </div>
        ) : (
          <p className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
            선택 매물종류({typeLabels}) 실거래 표본이 부족해 시세를 집계하지 못했어요.
          </p>
        )}

        {/* 전세가율(깡통전세·전세사기 위험도) — 매매·전세 median 둘 다 있을 때만 노출 */}
        {price?.sale && price?.jeonse && (
          <JeonseRiskBar
            saleManwon={price.sale.medianManwon}
            jeonseManwon={price.jeonse.depositMedianManwon}
            sampleCount={price.jeonse.sampleCount}
          />
        )}

        {/* 반전세 비율 — KI-18 P2 #2 (KI-10 후속). 순수 월세 median 이 반전세를 제외함을 안내 */}
        {detail?.semiJeonseRatio && (
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-tertiary dark:text-ink-tertiary-dark">
            월세 표본 중 <b className="font-semibold text-ink-secondary dark:text-ink-secondary-dark">반전세</b>(보증금 큰 월세){' '}
            <span className="tabular-nums font-semibold text-ink-secondary dark:text-ink-secondary-dark">{detail.semiJeonseRatio.ratioPct}%</span>
            <span className="tabular-nums"> ({detail.semiJeonseRatio.semiJeonse.toLocaleString()}/{detail.semiJeonseRatio.totalWolse.toLocaleString()}건)</span>
            {' '}— 위 순수 월세 중위값은 반전세 제외 기준이에요.
          </p>
        )}

        {/* 면적대별(소/중/대) 분포 — KI-18 P2 #1+#4. dealType 값 없으면 자체 숨김 */}
        {detail?.priceByTier && detail.priceByTier.length > 0 && (
          <AreaTierBars tiers={detail.priceByTier} dealType={dealType} />
        )}
      </div>

      {/* (A) 4축 분해 */}
      <div>
        <h3 className="text-xs font-bold text-ink-secondary dark:text-ink-secondary-dark mb-1.5">4축 상세</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* 통근 — 동 centroid → 직장 자차/대중교통 비교(전 매물종류) + 교통 품질 */}
          <AxisCard title="통근" score={region.commuteScore} estimated={estimated.has('commute')}>
            <div className="flex flex-col gap-0.5 text-2xs text-ink-secondary dark:text-ink-secondary-dark tabular-nums">
              {commute ? (
                <>
                  <span>대중교통 {commute.transitMinutes}분{commute.transfers > 0 ? ` · 환승 ${commute.transfers}회` : ''}</span>
                  <span>자차 {commute.carMinutes}분{commute.carSource === 'kakao' ? ' · 실경로' : ''}</span>
                </>
              ) : (
                <span>편도 {region.commuteMinutes}분{hasWorkplace ? ' (추정)' : ' · 직장 미설정'}</span>
              )}
              {transit ? (
                <span>정류장 {transit.stationCount}곳{transit.avgHeadwayMin != null ? ` · 배차 ${Math.round(transit.avgHeadwayMin)}분` : ''}{transit.nightAccessible ? ' · 심야○' : ''}</span>
              ) : (
                <span className="text-ink-tertiary">교통 품질 미집계</span>
              )}
            </div>
          </AxisCard>

          {/* 주거비 */}
          <AxisCard title="주거비" score={region.affordabilityScore} estimated={estimated.has('affordability')}>
            <div className="flex flex-col gap-0.5 text-2xs text-ink-secondary dark:text-ink-secondary-dark tabular-nums">
              {region.rir != null && <span>RIR {region.rir}%</span>}
              {region.monthlyHousingCost != null && <span>월 주거비 {region.monthlyHousingCost.toLocaleString()}만</span>}
              <span className="text-ink-tertiary">
                {region.affordabilityBasis === 'sale-proxy' ? '매매가 합성(전월세 표본 부족)' : '실거래 전월세 기준'}
              </span>
            </div>
          </AxisCard>

          {/* 치안 */}
          <AxisCard title="치안" score={region.safetyScore} estimated={estimated.has('safety')}>
            {safety ? (
              <div className="flex flex-col gap-1">
                <MiniBar label="범죄 안전" value={safety.crimeScore} />
                <MiniBar label="가로등" value={safety.lightScore} />
                <MiniBar label="CCTV" value={safety.cctvScore} />
              </div>
            ) : (
              <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">치안 지표 미집계</span>
            )}
          </AxisCard>

          {/* 생활 */}
          <AxisCard title="생활" score={region.lifeScore} estimated={estimated.has('life')}>
            {life ? (
              <div className="grid grid-cols-4 gap-x-1.5 gap-y-1">
                {POI_CATS.map((cat) => (
                  <div key={cat.key} className="flex flex-col items-center">
                    <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">{cat.label}</span>
                    <span className="text-xs font-semibold tabular-nums text-ink-secondary dark:text-ink-secondary-dark">
                      {life[cat.key]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">생활(POI) 미집계 · 반경 500m</span>
            )}
          </AxisCard>
        </div>
      </div>

      {/* 출처 footer */}
      <div className="flex items-center gap-2 flex-wrap text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">
        <span className="font-semibold text-ink-secondary dark:text-ink-secondary-dark shrink-0">데이터</span>
        <span>국토부 RTMS</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>경찰청·지자체 치안</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>카카오 로컬 POI</span>
        <span className="w-px h-2.5 bg-line-light dark:bg-line-dark" />
        <span>TAGO·TOPIS</span>
      </div>
    </div>
  );
}

// ─── 시세 행 ─────────────────────────────────────────────────
function PriceRow({
  label,
  highlight,
  chip,
  children,
}: {
  label: string;
  highlight?: boolean;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-card px-2.5 py-1.5',
        highlight
          ? 'bg-brand/10 dark:bg-brand/20'
          : 'bg-surface dark:bg-surface-dark-elevated-hover',
      ].join(' ')}
    >
      <span className="text-2xs font-semibold w-8 shrink-0 text-ink-secondary dark:text-ink-secondary-dark">{label}</span>
      <div className="flex-1 flex items-baseline text-sm text-ink-primary dark:text-ink-primary-dark">{children}</div>
      {chip}
    </div>
  );
}

// ─── 전세가율 = 전세사기·깡통전세 위험도 ─────────────────────────
//  전세가율 = 전세 보증금 median ÷ 매매가 median × 100.
//  ▷ 정직 주의: 동 단위 중위값 비교라 면적·매물 구성이 다를 수 있어 개별 매물·단지
//    판단 도구가 아님(참고 지표). 같은 propertyTypes 풀에서 집계된 두 median 비교.
//  ▷ 밴드: <80 안전 / 80~89 주의 / ≥90 위험(HUG 전세보증금반환보증 90% 기준선).
const JEONSE_RISK_TIP =
  '전세가율 = 전세 보증금 ÷ 매매가. 동 중위값 기준 추정이라 개별 매물·단지와 다를 수 있어요. ' +
  '80%를 넘으면 시세가 내리거나 경매로 넘어갈 때 보증금을 온전히 돌려받기 어려운 "깡통전세" 주의 구간입니다. ' +
  '계약 전 등기부등본·선순위 채권·전세보증보험 가입 가능 여부를 꼭 확인하세요.';

function jeonseRiskBand(ratio: number): {
  label: string;
  bar: string;
  text: string;
  badge: string;
  desc: string;
} {
  if (ratio >= 90)
    return {
      label: '위험',
      bar: 'bg-rose-500',
      text: 'text-rose-600 dark:text-rose-400',
      badge: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
      desc: '깡통전세 위험 구간 — 경매 시 보증금 미회수 우려',
    };
  if (ratio >= 80)
    return {
      label: '주의',
      bar: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
      desc: '시세 하락 시 보증금 일부를 못 돌려받을 수 있어요',
    };
  return {
    label: '안전',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    desc: '매매가 대비 보증금에 여유가 있는 편',
  };
}

function JeonseRiskBar({
  saleManwon,
  jeonseManwon,
  sampleCount,
}: {
  saleManwon: number;
  jeonseManwon: number;
  sampleCount: number;
}) {
  if (saleManwon <= 0 || jeonseManwon <= 0) return null;
  const ratio = Math.round((jeonseManwon / saleManwon) * 100);
  const band = jeonseRiskBand(ratio);
  // 막대 스케일 0~120%(역전세까지 보이게). 80/90 경계에 눈금.
  const SCALE = 120;
  const fillPct = Math.max(0, Math.min(100, (ratio / SCALE) * 100));
  const lowSample = sampleCount < 10;

  return (
    <div className="mt-2.5 rounded-card bg-surface dark:bg-surface-dark-elevated-hover px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className="text-2xs font-bold text-ink-secondary dark:text-ink-secondary-dark">전세가율</span>
        <InfoTooltip text={JEONSE_RISK_TIP} />
        <span className={`text-sm font-bold tabular-nums ${band.text}`}>{ratio}%</span>
        <span className={`text-2xs font-bold px-1.5 py-0.5 rounded ${band.badge}`}>{band.label}</span>
        <span className="ml-auto text-2xs text-ink-tertiary dark:text-ink-tertiary-dark">전세사기 위험도</span>
      </div>

      {/* 막대 + 80/90 경계 눈금 */}
      <div className="relative h-2 rounded-full bg-line-light dark:bg-line-dark overflow-hidden">
        <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${fillPct}%` }} />
        {/* 경계선: 80%(주의 시작) · 90%(위험 시작) */}
        <span className="absolute top-0 bottom-0 w-px bg-ink-tertiary/40 dark:bg-ink-tertiary-dark/40" style={{ left: `${(80 / SCALE) * 100}%` }} />
        <span className="absolute top-0 bottom-0 w-px bg-ink-tertiary/40 dark:bg-ink-tertiary-dark/40" style={{ left: `${(90 / SCALE) * 100}%` }} />
      </div>

      <p className={`mt-1 text-2xs ${band.text}`}>{band.desc}</p>
      <p className="mt-0.5 text-2xs leading-relaxed text-ink-tertiary dark:text-ink-tertiary-dark">
        동 중위값(매매 {fmtEok(saleManwon)} · 전세 {fmtEok(jeonseManwon)}) 비교 · 전세 표본 {sampleCount.toLocaleString()}건
        {lowSample ? ' · 표본 적어 참고용' : ''} · 개별 매물 판단용 아님
      </p>
    </div>
  );
}

// ─── 면적대별(소/중/대) 시세 분포 막대 (KI-18 P2 #1+#4) ──────────
//  거래유형별로 해당 값(매매가/전세보증금/순수월세)을 구간별 median 으로 보여줌.
//  값이 없는 구간(표본<5 또는 거래 없음)은 "표본 부족". 전 구간 값 없으면 컴포넌트 자체 숨김.
function AreaTierBars({ tiers, dealType }: { tiers: AreaTierPrice[]; dealType: RecDealType }) {
  const pick = (t: AreaTierPrice): { value: number | null; sample: number | null } => {
    if (dealType === 'SALE') return { value: t.sale?.medianManwon ?? null, sample: null };
    if (dealType === 'JEONSE')
      return { value: t.jeonse?.depositMedianManwon ?? null, sample: t.jeonse?.sampleCount ?? null };
    return { value: t.monthly?.pureMonthlyMedianManwon ?? null, sample: t.monthly?.sampleCount ?? null };
  };
  const rows = tiers.map((t) => ({ tier: t.tier, areaLabel: t.areaLabel, ...pick(t) }));
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  if (max <= 0) return null; // 이 거래유형에 표시할 값이 한 구간도 없음

  const heading =
    dealType === 'SALE' ? '면적대별 매매 (중위)' : dealType === 'JEONSE' ? '면적대별 전세 보증금 (중위)' : '면적대별 월세 (중위)';
  const fmtVal = (v: number) => (dealType === 'MONTHLY' ? `월 ${v.toLocaleString()}만` : fmtEok(v));

  return (
    <div className="mt-2.5">
      <h4 className="text-2xs font-semibold text-ink-tertiary dark:text-ink-tertiary-dark mb-1.5">{heading}</h4>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.tier} className="flex items-center gap-2">
            <span className="w-[4.5rem] shrink-0 text-2xs text-ink-secondary dark:text-ink-secondary-dark">
              <span className="font-semibold">{r.tier}</span>
              <span className="ml-1 text-ink-tertiary dark:text-ink-tertiary-dark">{r.areaLabel}</span>
            </span>
            <div className="flex-1 h-2 rounded-full bg-line-light dark:bg-line-dark overflow-hidden">
              {r.value != null && (
                <div className="h-full rounded-full bg-brand/70" style={{ width: `${(r.value / max) * 100}%` }} />
              )}
            </div>
            <span className="w-[5.5rem] shrink-0 text-right text-2xs tabular-nums">
              {r.value != null ? (
                <>
                  <span className="font-semibold text-ink-primary dark:text-ink-primary-dark">{fmtVal(r.value)}</span>
                  {r.sample != null && (
                    <span className={r.sample < 10 ? 'ml-1 text-amber-600 dark:text-amber-400' : 'ml-1 text-ink-tertiary dark:text-ink-tertiary-dark'}>
                      {r.sample}건
                    </span>
                  )}
                </>
              ) : (
                <span className="text-ink-tertiary dark:text-ink-tertiary-dark">표본 부족</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 안전 3종 미니 막대 ───────────────────────────────────────
function MiniBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs text-ink-tertiary dark:text-ink-tertiary-dark w-12 shrink-0">{label}</span>
      <div className="h-1 flex-1 rounded-full bg-line-light dark:bg-line-dark overflow-hidden">
        <div className={`h-full rounded-full ${tierColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs tabular-nums text-ink-secondary dark:text-ink-secondary-dark w-6 text-right">{Math.round(pct)}</span>
    </div>
  );
}
