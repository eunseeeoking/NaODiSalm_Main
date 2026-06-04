/**
 * 지하철 라우터 싱글톤 + **비대칭 하이브리드** 폴백 (odsay 분석 §7.3 배선).
 *
 *  통합 전략 (scripts/calibrateRouter.ts, ODsay 240표본 검증):
 *    직선추정을 라우터로 **무조건 교체하면 오히려 악화**(라우터 낙관·그래프갭). 대신
 *    **라우터가 직선보다 *느리다*고 할 때만 라우터값 채택** → 전체 MAE 11.7→10.7,
 *    거짓양성(가깝지만 느린 동) MAE 18.7→13.8 개선. 라우터는 "더 빠르게" 만들지 않음(안전).
 *
 *  · 그래프(subway-graph.json) 미적재/손상 시 라우터 비활성 → 항상 직선 폴백(무중단).
 *  · env COMMUTE_ROUTER=off 로 비활성화 가능(기본 on).
 */
import { SubwayRouter, type LatLng } from './subwayRouter';
import { loadSubwayGraph } from './subwayGraphLoader';

/**
 * 라우터 적용 최소 직선추정(분). 이보다 짧은 근거리는 **걷기·버스·짧은 지하철**이 경쟁력이라
 *  지하철-only 라우터가 과대추정(예: 하남 신장동 직선~10분인데 라우터 29분). 그 구간은 직선 유지.
 *  ≈5.5km. ODsay 표본 캘리브레이션상 T=18 이 MAE 최저(10.34, scripts/calibrateRouter.ts).
 */
const ROUTER_MIN_STRAIGHT_MIN = 18;

let _router: SubwayRouter | null | undefined; // undefined=미시도, null=비활성

function getRouter(): SubwayRouter | null {
  if (_router !== undefined) return _router;
  if (process.env.COMMUTE_ROUTER === 'off') { _router = null; return null; }
  const graph = loadSubwayGraph();
  _router = graph ? new SubwayRouter(graph) : null; // 기본 cfg = 캘리브레이션값
  if (graph) {
    console.log(`[subway-router] 활성 (역 ${graph.stations.length}, 구간 ${graph.rides.length})`);
  }
  return _router;
}

/**
 * 비대칭 하이브리드 통근분: 라우터가 직선추정보다 **느릴 때만** 라우터값, 아니면 직선.
 *  @param straightMinutes 직선거리 기반 추정(estimateTransitMinutesByKm) — 기준·폴백.
 */
export function hybridTransitMinutes(
  origin: LatLng,
  dest: LatLng,
  straightMinutes: number,
): number {
  const router = getRouter();
  if (!router || straightMinutes < ROUTER_MIN_STRAIGHT_MIN) return straightMinutes;
  const r = router.route(origin, dest);
  return r && r.minutes > straightMinutes ? r.minutes : straightMinutes;
}

/**
 * 일괄(단일 출발 → 다수 도착) 비대칭 하이브리드 — 추천 랭킹용(Dijkstra 1회).
 *  @param straightMinutes dests 와 같은 순서의 직선추정 배열.
 */
export function hybridTransitMinutesMany(
  origin: LatLng,
  dests: LatLng[],
  straightMinutes: number[],
): number[] {
  const router = getRouter();
  if (!router) return straightMinutes.slice();
  // 근거리(임계 미만)는 라우터 호출 없이 직선 유지 — 과대 방지 + 라우팅 절감
  const dest2 = dests.map((d, i) => (straightMinutes[i] >= ROUTER_MIN_STRAIGHT_MIN ? d : null));
  const toRoute = dest2.filter((d): d is LatLng => d !== null);
  if (toRoute.length === 0) return straightMinutes.slice();
  const routed = router.routeMany(origin, toRoute);
  let k = 0;
  return dests.map((_, i) => {
    if (dest2[i] === null) return straightMinutes[i];
    const r = routed[k++];
    return r && r.minutes > straightMinutes[i] ? r.minutes : straightMinutes[i];
  });
}

/** 테스트/재적재용 */
export function _resetRouterSingleton(): void {
  _router = undefined;
}
