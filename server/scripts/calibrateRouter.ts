/**
 * 라우터 vs ODsay 정확도 측정 (캘리브레이션) — odsay 분석 §7.3 잔여3.
 *  이미 확보한 ODsay 표본(commute-accuracy-samples.json, ③)으로 **쿼터 0** 으로 검증:
 *    · 라우터 통근분 vs ODsay 실측 (MAE/bias)
 *    · 직선추정 vs ODsay (대조) → 라우터가 직선보다 정확한지 정량 비교
 *    · 라우터 커버리지(도보권역·연결 있어 경로 산출된 비율)
 *  transferPenalty/walkMaxKm 그리드로 최적값 탐색.
 *
 *  실행: cd server && npx tsx scripts/calibrateRouter.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { SubwayRouter, type RouterConfig } from '../src/services/commute/subwayRouter';
import { loadSubwayGraph } from '../src/services/commute/subwayGraphLoader';

const graph = loadSubwayGraph();
if (!graph) { console.error('subway-graph.json 없음 — seed:subway-graph 먼저.'); process.exit(1); }

// measureCommuteAccuracy 의 WORKPLACES 와 동일 좌표 (표본 키=label)
const WP: Record<string, { lat: number; lng: number }> = {
  '강남역': { lat: 37.4979, lng: 127.0276 },
  '부천시청 인근': { lat: 37.5035, lng: 126.766 },
  '여의도역': { lat: 37.5215, lng: 126.9242 },
  '판교역': { lat: 37.3947, lng: 127.1112 },
  '잠실역': { lat: 37.5133, lng: 127.1001 },
};

interface Sample { lat: number; lng: number; distanceKm: number; straightEst: number; odsayMin: number | null }
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'doc', '2026-06-04', 'commute-accuracy-samples.json'), 'utf-8'));
const samplesByWp: Record<string, Sample[]> = raw.samples;

function stats(errs: number[]) {
  if (errs.length === 0) return { n: 0, mae: NaN, bias: NaN };
  const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
  const bias = errs.reduce((s, e) => s + e, 0) / errs.length;
  return { n: errs.length, mae, bias };
}

function evaluate(cfg: Partial<RouterConfig>) {
  const router = new SubwayRouter(graph!, cfg);
  let covered = 0, total = 0;
  const routerErr: number[] = [];   // router − odsay (라우터가 라우팅한 표본만)
  const straightErrOnCovered: number[] = []; // 같은 표본의 직선 − odsay (공정 비교)
  for (const [wpLabel, samples] of Object.entries(samplesByWp)) {
    const wp = WP[wpLabel]; if (!wp) continue;
    for (const s of samples) {
      if (s.odsayMin == null) continue;
      total++;
      const r = router.route({ lat: s.lat, lng: s.lng }, wp);
      if (r) {
        covered++;
        routerErr.push(r.minutes - s.odsayMin);
        straightErrOnCovered.push(s.straightEst - s.odsayMin);
      }
    }
  }
  return { total, covered, router: stats(routerErr), straight: stats(straightErrOnCovered) };
}

console.log(`그래프: stations ${graph.stations.length}, rides ${graph.rides.length}`);

// 1) 기본 설정 평가
const base = evaluate({ transferPenaltyMin: 4, walkMaxKm: 1.2, boardingOverheadMin: 4 });
console.log(`\n[기본 cfg] 표본 ${base.total} 중 라우터 커버 ${base.covered} (${(base.covered / base.total * 100).toFixed(0)}%)`);
console.log(`  라우터  MAE ${base.router.mae.toFixed(1)}  bias ${base.router.bias.toFixed(1)}  (n=${base.router.n})`);
console.log(`  직선(동일표본) MAE ${base.straight.mae.toFixed(1)}  bias ${base.straight.bias.toFixed(1)}`);
console.log(`  → 라우터가 직선 대비 MAE ${(base.straight.mae - base.router.mae).toFixed(1)}분 ${base.router.mae < base.straight.mae ? '개선' : '악화'}`);

// 2) boardingOverhead(초기대기+접근 보정) 탐색 — bias 제거가 핵심
console.log('\n[boardingOverhead 탐색] tp4·wk1.2 고정 → 라우터 MAE / bias');
for (const bo of [4, 8, 10, 12, 14, 16]) {
  const e = evaluate({ transferPenaltyMin: 4, walkMaxKm: 1.2, boardingOverheadMin: bo });
  console.log(`  bo${String(bo).padStart(2)}: MAE ${e.router.mae.toFixed(1)}  bias ${e.router.bias.toFixed(1)}  (직선 MAE ${e.straight.mae.toFixed(1)})`);
}

// 3) 3차원 그리드 (tp × wk × bo) — MAE 최소 (커버리지 ≥60% 제약)
console.log('\n[3D 그리드] 최적 탐색 (커버 ≥60%)');
let best: { tp: number; wk: number; bo: number; mae: number; bias: number; cov: number } | null = null;
for (const tp of [3, 4, 5])
  for (const wk of [1.0, 1.2, 1.5])
    for (const bo of [8, 10, 12, 14]) {
      const e = evaluate({ transferPenaltyMin: tp, walkMaxKm: wk, boardingOverheadMin: bo });
      const cov = e.covered / e.total;
      if (cov < 0.6) continue;
      if (!best || e.router.mae < best.mae) best = { tp, wk, bo, mae: e.router.mae, bias: e.router.bias, cov };
    }
if (best) {
  console.log(`최적: transferPenalty=${best.tp}, walkMaxKm=${best.wk}, boardingOverhead=${best.bo}`);
  console.log(`  → 라우터 MAE ${best.mae.toFixed(1)}분, bias ${best.bias.toFixed(1)}, 커버 ${(best.cov * 100).toFixed(0)}%`);
}

// 4) 통합 전략 비교 — 전체 240표본(미커버는 직선 폴백)에서 estimator MAE.
//    핵심: 라우터를 *언제* 채택해야 직선보다 나은가? (FP 신호=라우터가 더 느리다고 할 때만?)
const CFG = { transferPenaltyMin: 4, walkMaxKm: 1.2, boardingOverheadMin: 14 }; // 배선 설정
const router = new SubwayRouter(graph, CFG);
const all: { straight: number; router: number | null; odsay: number }[] = [];
for (const [wpLabel, samples] of Object.entries(samplesByWp)) {
  const wp = WP[wpLabel]; if (!wp) continue;
  for (const s of samples) {
    if (s.odsayMin == null) continue;
    const r = router.route({ lat: s.lat, lng: s.lng }, wp);
    all.push({ straight: s.straightEst, router: r ? r.minutes : null, odsay: s.odsayMin });
  }
}
const maeOf = (pick: (x: typeof all[number]) => number) =>
  all.reduce((s, x) => s + Math.abs(pick(x) - x.odsay), 0) / all.length;

const S_straight = maeOf((x) => x.straight);
const S_routerOr = maeOf((x) => x.router ?? x.straight);
const S_max = maeOf((x) => Math.max(x.straight, x.router ?? x.straight));
const S_slower = maeOf((x) => (x.router != null && x.router > x.straight ? x.router : x.straight));

console.log('\n[통합 전략 비교] 전체 ' + all.length + '표본 MAE (미커버=직선 폴백)');
console.log(`  S0 직선만                 : ${S_straight.toFixed(2)}`);
console.log(`  S1 라우터 우선(커버시)       : ${S_routerOr.toFixed(2)}`);
console.log(`  S2 max(직선,라우터)         : ${S_max.toFixed(2)}`);
console.log(`  S3 라우터>직선 일때만 채택    : ${S_slower.toFixed(2)}  ← FP 신호 한정`);

// S3 + 최소 직선시간 임계 (짧은 거리=걷기/버스 우위 → 라우터 미적용, 하남 인접동 과대 방지)
console.log('\n[S3 + 직선시간 임계] 임계 미만은 직선 유지');
for (const T of [0, 12, 15, 18, 20, 25]) {
  const mae = maeOf((x) => (x.router != null && x.straight >= T && x.router > x.straight ? x.router : x.straight));
  const adopted = all.filter((x) => x.router != null && x.straight >= T && x.router > x.straight).length;
  console.log(`  T=${String(T).padStart(2)}분: MAE ${mae.toFixed(2)}  (라우터 채택 ${adopted}건)`);
}

// FP 부분집합(직선이 10분+ 과소추정 = odsay가 직선보다 훨씬 느림)에서의 개선
const fp = all.filter((x) => x.odsay > x.straight + 10);
const maeFp = (pick: (x: typeof all[number]) => number) =>
  fp.reduce((s, x) => s + Math.abs(pick(x) - x.odsay), 0) / fp.length;
console.log(`\n[거짓양성 부분집합 n=${fp.length}] (직선이 10분+ 과소)`);
console.log(`  직선만        MAE ${maeFp((x) => x.straight).toFixed(1)}`);
console.log(`  S3(느릴때채택) MAE ${maeFp((x) => (x.router != null && x.router > x.straight ? x.router : x.straight)).toFixed(1)}`);
