/**
 * ③ 거짓 음성(false negative) 규모 실측 — odsay 통근 라우팅 분석 §7.
 *
 *  목적: 현 **직선거리 게이트**가 부당하게 자르는 동 수를 ODsay 실측으로 정량화한다.
 *    (내부 지하철 라우터 투자 정당화 + 라우터 캘리브레이션 기준점)
 *
 *  방법:
 *    1) 서빙과 **동일한 universe**(fetchRegionAggregates) + centroid 사용.
 *    2) 각 동: Haversine 거리 → 직선 추정 통근분(estimateTransitMinutesByKm, §8-4 단일 공식).
 *    3) 거리대별 **층화표본**으로 ODsay 실측을 호출(쿼터 절약) → 추정 vs 실측 비교.
 *    4) patience 30/45/60 각각에서 게이트 판정(추정 기준) vs 진실(ODsay 기준) 교차:
 *         · 거짓음성(FN): 게이트가 잘랐는데(추정>patience×1.2) 실측은 빠름(≤patience)  ← 핵심 지표
 *         · 거짓양성(FP): 게이트가 통과시켰는데(추정≤patience×1.2) 실측은 느림(>patience×1.2)
 *    5) 표본 율 → universe 의 잘린 동 수로 외삽 + 추정오차 분포(MAE·bias·p90).
 *
 *  쿼터 안전:
 *    · fetchOdsayBatch(=fetchOdsayRoute) 가 내부 800 게이트를 그대로 존중 → 라이브 보호.
 *    · 시작 시 남은 쿼터를 확인하고 PROBE_BUDGET 을 그 이하로 캡.
 *    · DRY_RUN=1 이면 ODsay 호출 0 — universe 규모·거리 히스토그램·계획 probe 수만 출력.
 *
 *  실행:
 *    cd server
 *    DRY_RUN=1 npx tsx scripts/measureCommuteAccuracy.ts        # 쿼터 0, 계획만
 *    PROBE_BUDGET=120 npx tsx scripts/measureCommuteAccuracy.ts # 실측 (워크플레이스당 최대 120콜)
 *
 *  산출물: server/doc/2026-06-04/commute-accuracy-samples.json (원 표본 — ② 라우터 캘리브레이션용)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fetchRegionAggregates } from '../src/services/repositories/recommendationRepository';
import { ALL_PROPERTY_TYPES } from '../src/services/recommendation/scoring';
import {
  haversineKm,
  estimateTransitMinutesByKm,
  fetchOdsayBatch,
} from '../src/services/external/odsay';
import { getOdsayUsageToday } from '../src/services/external/odsayQuota';
import { prisma } from '../src/services/db';

// ── 설정 ───────────────────────────────────────────────────────────
const PATIENCE_LEVELS = [30, 45, 60];
const GATE_MULT = 1.2; // recommendationRepository PATIENCE_GATE_MULT (KI-22)
const DRY_RUN = process.env.DRY_RUN === '1';
const PROBE_BUDGET = Number(process.env.PROBE_BUDGET ?? '120'); // 워크플레이스당 ODsay 호출 상한
const MAX_DIST_KM = Number(process.env.MAX_DIST_KM ?? '50');    // 분석 대상 거리 상한 (patience60 게이트 밴드 포함)
const BAND_KM = 5; // 층화표본 거리 구간
const QUOTA_SAFETY_MARGIN = 50; // 라이브용으로 남겨둘 여유

// 대표 직장 — radial hub(강남) + 경인선 corridor(부천: 삼산동 케이스의 무대)
const WORKPLACES: { lat: number; lng: number; label: string }[] = [
  { lat: 37.4979, lng: 127.0276, label: '강남역' },
  { lat: 37.5035, lng: 126.766, label: '부천시청 인근' },
];

interface DongMetric {
  code: string;
  sigungu: string;
  dong: string;
  lat: number;
  lng: number;
  distanceKm: number;
  straightEst: number;
  odsayMin: number | null;
  odsayTransfers: number | null;
}

/** 거리대별 층화표본 — 각 밴드에서 고르게 뽑아 경계 구간 커버 */
function stratifiedSample<T extends { distanceKm: number }>(items: T[], budget: number): T[] {
  if (items.length <= budget) return items;
  const bands = new Map<number, T[]>();
  for (const it of items) {
    const b = Math.floor(it.distanceKm / BAND_KM);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b)!.push(it);
  }
  const bandKeys = [...bands.keys()].sort((a, b) => a - b);
  const perBand = Math.max(1, Math.floor(budget / bandKeys.length));
  const picked: T[] = [];
  for (const k of bandKeys) {
    const arr = bands.get(k)!;
    // 밴드 내 균등 간격 추출
    const step = Math.max(1, Math.floor(arr.length / perBand));
    for (let i = 0; i < arr.length && picked.length < budget; i += step) {
      picked.push(arr[i]);
    }
  }
  return picked.slice(0, budget);
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function measureWorkplace(
  wp: { lat: number; lng: number; label: string },
  aggregates: Awaited<ReturnType<typeof fetchRegionAggregates>>,
  budget: number,
): Promise<DongMetric[]> {
  // 1) 거리 + 직선추정
  const all: DongMetric[] = aggregates
    .map((a) => {
      const distanceKm = haversineKm(wp, { lat: a.centroidLat, lng: a.centroidLng });
      return {
        code: a.legalDongCode,
        sigungu: a.sigungu,
        dong: a.dong,
        lat: a.centroidLat,
        lng: a.centroidLng,
        distanceKm,
        straightEst: estimateTransitMinutesByKm(distanceKm),
        odsayMin: null as number | null,
        odsayTransfers: null as number | null,
      };
    })
    .filter((d) => d.distanceKm <= MAX_DIST_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // 거리 히스토그램
  const hist = new Map<number, number>();
  for (const d of all) {
    const b = Math.floor(d.distanceKm / BAND_KM) * BAND_KM;
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  console.log(`\n${'='.repeat(78)}`);
  console.log(`📍 ${wp.label} (${wp.lat},${wp.lng})  분석대상 ${all.length}동 (≤${MAX_DIST_KM}km)`);
  console.log('   거리대 히스토그램:');
  for (const b of [...hist.keys()].sort((a, c) => a - c)) {
    console.log(`     ${String(b).padStart(2)}~${b + BAND_KM}km : ${hist.get(b)}`);
  }

  // 2) 층화표본
  const sample = stratifiedSample(all, budget);
  console.log(`   계획 ODsay probe: ${sample.length}콜 (budget ${budget})`);

  if (DRY_RUN) {
    console.log('   [DRY_RUN] ODsay 미호출.');
    return all;
  }

  // 3) ODsay 실측 (배치, rate-limit 내장)
  const t0 = Date.now();
  const results = await fetchOdsayBatch(
    wp,
    sample.map((s) => ({ lat: s.lat, lng: s.lng })),
  );
  console.log(`   ODsay 완료: ${sample.length}콜 / ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  for (let i = 0; i < sample.length; i++) {
    const r = results[i];
    if (r) {
      sample[i].odsayMin = r.transitMinutes;
      sample[i].odsayTransfers = r.transitTransfers;
    }
  }
  return all; // straightEst 는 all 전체 보유, odsay 는 sample 만 채워짐 (같은 객체 참조)
}

/** 게이트 판정 교차분석 + 출력 */
function analyze(wpLabel: string, metrics: DongMetric[]) {
  const probed = metrics.filter((m) => m.odsayMin != null);
  if (probed.length === 0) {
    console.log(`\n[${wpLabel}] ODsay 표본 0 — 분석 생략 (DRY_RUN 또는 쿼터 차단).`);
    return;
  }

  // 추정오차 분포 (직선추정 − 실측)
  const errors = probed.map((m) => m.straightEst - (m.odsayMin as number));
  const absErrors = errors.map((e) => Math.abs(e));
  const bias = errors.reduce((s, e) => s + e, 0) / errors.length;
  const mae = absErrors.reduce((s, e) => s + e, 0) / absErrors.length;
  const p90 = [...absErrors].sort((a, b) => a - b)[Math.floor(absErrors.length * 0.9)];

  console.log(`\n${'-'.repeat(78)}`);
  console.log(`📊 [${wpLabel}] ODsay 표본 ${probed.length}동 추정오차 (직선추정 − 실측, 분)`);
  console.log(`     bias(평균오차) ${bias.toFixed(1)}  |  MAE ${mae.toFixed(1)}  |  중앙 ${median(errors).toFixed(1)}  |  |오차|p90 ${p90}`);
  console.log(`     ※ bias>0 = 직선추정이 과대(실제보다 느리게 봄 → 거짓음성 유발), <0 = 과소(거짓양성 유발)`);

  for (const P of PATIENCE_LEVELS) {
    const gate = P * GATE_MULT;
    let fn = 0, fp = 0, tp = 0, tn = 0;
    const fnExamples: DongMetric[] = [];
    const fpExamples: DongMetric[] = [];
    for (const m of probed) {
      const cut = m.straightEst > gate;          // 게이트가 자름(추정 기준)
      const fast = (m.odsayMin as number) <= P;  // 진실: 인내심 내
      const slow = (m.odsayMin as number) > gate; // 진실: 명백히 초과
      if (cut && fast) { fn++; fnExamples.push(m); }
      else if (!cut && slow) { fp++; fpExamples.push(m); }
      else if (cut && !fast) tn++;
      else tp++;
    }
    const cutCount = probed.filter((m) => m.straightEst > gate).length;
    const admitCount = probed.length - cutCount;
    console.log(`\n   ▷ patience ${P}분 (게이트 컷 = 추정 > ${gate.toFixed(0)}분)`);
    console.log(`     표본 컷 ${cutCount} / 통과 ${admitCount}`);
    console.log(`     거짓음성 FN ${fn}  (잘린 것 중 ${pct(fn, cutCount)} 이 실제 ≤${P}분) ← 영구 누락`);
    console.log(`     거짓양성 FP ${fp}  (통과 중 ${pct(fp, admitCount)} 이 실제 >${gate.toFixed(0)}분)`);
    if (fnExamples.length) {
      console.log('     FN 예시:');
      fnExamples.slice(0, 6).forEach((m) =>
        console.log(`        ${`${m.sigungu} ${m.dong}`.padEnd(20)} 직선 ${m.distanceKm.toFixed(1)}km 추정 ${m.straightEst}분 → 실측 ${m.odsayMin}분(환승${m.odsayTransfers})`),
      );
    }
    if (fpExamples.length) {
      console.log('     FP 예시:');
      fpExamples.slice(0, 4).forEach((m) =>
        console.log(`        ${`${m.sigungu} ${m.dong}`.padEnd(20)} 직선 ${m.distanceKm.toFixed(1)}km 추정 ${m.straightEst}분 → 실측 ${m.odsayMin}분(환승${m.odsayTransfers})`),
      );
    }
    // universe 외삽
    const uniCut = metrics.filter((m) => m.straightEst > gate).length;
    const fnRate = cutCount === 0 ? 0 : fn / cutCount;
    console.log(`     ▶ universe 잘린 동 ${uniCut} × FN율 ${pct(fn, cutCount)} ≈ 추정 거짓음성 ~${Math.round(uniCut * fnRate)}동`);
  }
}

(async () => {
  try {
    const usage = await getOdsayUsageToday();
    console.log(`ODsay 오늘 사용량: ${usage.callCount}/${800} (남음 ${usage.remaining}, 차단 ${usage.blocked})`);
    const availableForProbe = Math.max(0, usage.remaining - QUOTA_SAFETY_MARGIN);

    // universe (서빙과 동일) — ALL 매물종류로 centroid 최대 커버
    const aggregates = await fetchRegionAggregates(ALL_PROPERTY_TYPES);
    console.log(`서빙 universe(수도권, 전 매물종류 centroid): ${aggregates.length}동`);

    if (!DRY_RUN && usage.blocked) {
      console.log('⚠️ 쿼터 차단 상태 — 실측 불가. DRY_RUN 으로 계획만 보거나 KST 자정 후 재시도.');
      return;
    }

    // 워크플레이스별 예산 배분
    let perWpBudget = PROBE_BUDGET;
    if (!DRY_RUN) {
      const totalWanted = PROBE_BUDGET * WORKPLACES.length;
      if (totalWanted > availableForProbe) {
        perWpBudget = Math.max(10, Math.floor(availableForProbe / WORKPLACES.length));
        console.log(`⚠️ 남은 쿼터 부족 → 워크플레이스당 ${perWpBudget}콜로 축소 (총 ~${perWpBudget * WORKPLACES.length})`);
      }
    }

    const allSamples: Record<string, DongMetric[]> = {};
    for (const wp of WORKPLACES) {
      const metrics = await measureWorkplace(wp, aggregates, perWpBudget);
      analyze(wp.label, metrics);
      allSamples[wp.label] = metrics.filter((m) => m.odsayMin != null);
    }

    // 표본 저장 (라우터 캘리브레이션용)
    if (!DRY_RUN) {
      const outPath = path.join(__dirname, '..', 'doc', '2026-06-04', 'commute-accuracy-samples.json');
      fs.writeFileSync(
        outPath,
        JSON.stringify({ measuredAt: new Date().toISOString(), patienceLevels: PATIENCE_LEVELS, gateMult: GATE_MULT, samples: allSamples }, null, 2),
        'utf-8',
      );
      console.log(`\n💾 표본 저장: ${outPath}`);
    }

    const after = await getOdsayUsageToday();
    console.log(`\nODsay 사용량(종료 시): ${after.callCount}/800 (이번 측정 ~${after.callCount - usage.callCount}콜)`);
  } catch (e) {
    console.error('FAIL:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
