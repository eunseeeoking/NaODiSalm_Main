/**
 * 내부 지하철 라우터 (쿼터 0) — odsay 통근 분석 §6 / §7.3.
 *
 *  ODsay 없이 **지하철 노선 그래프**만으로 (소요분, 환승수) 를 산출한다.
 *  목적: 직선거리 폴백의 구조적 오류(특히 거짓양성 — §7.1 실측: 가깝지만 환승 많아 느린 동)를
 *        외부 호출 0 으로 교정. demand-driven ODsay 캐시는 정밀 마감(top-8)에만.
 *
 *  그래프:
 *    · 노드(station instance)  : (역, 노선) 단위 — 같은 환승역도 노선별로 별개 노드
 *    · ride edge               : 같은 노선 인접역 (가중 = 구간 소요분; 표준데이터 시각표 or 기본 2.5분)
 *    · transfer edge           : 같은 환승역의 다른 노선 노드 사이 (가중 = transferPenaltyMin)
 *    · access(도보) edge       : 출발/도착 좌표 → 최근접 역 (Haversine 도보, walkMaxKm 내)
 *  → Dijkstra(시간 최소) → 경로 역추적으로 환승수 집계.
 *
 *  이 파일은 **데이터 비의존 엔진** — 정규화 SubwayGraphData 만 받으면 동작.
 *  실데이터(전국도시철도 표준데이터 15013205+15013206) 적재는 scripts/seedSubwayGraph.ts (§7.2).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** 역 (노선별 인스턴스). 같은 환승역이라도 노선마다 1개씩. */
export interface SubwayStation {
  /** 노드 고유 id (예: 역번호, 또는 `${line}:${name}`) */
  id: string;
  /** 역사명 (환승 연결 키로도 사용 가능) */
  name: string;
  /** 노선명 */
  line: string;
  lat: number;
  lng: number;
  /**
   * 환승 그룹 키 (같은 물리 역사를 공유하는 노드들이 동일 값).
   *  표준데이터의 환승역 정보로 채움. 미지정 시 buildGraph 가 name 동일·근접으로 자동 추론(옵션).
   */
  transferKey?: string;
}

/** 인접역 구간 (같은 노선). 무방향(양방향 자동 생성). */
export interface RideSegment {
  fromId: string;
  toId: string;
  /** 구간 소요분 (표준데이터 도착-출발 차). 생략 시 config.defaultRideMinutes */
  minutes?: number;
}

export interface SubwayGraphData {
  stations: SubwayStation[];
  rides: RideSegment[];
}

export interface RouterConfig {
  /** 환승 1회 패널티(분) = 도보 환승 + 평균 대기(배차/2). 노선 배차 미상 시 상수. */
  transferPenaltyMin: number;
  /** 구간 소요분 기본값 (시각표 없을 때) */
  defaultRideMinutes: number;
  /** 도보 속도 (km/h) */
  walkSpeedKmH: number;
  /** 출발/도착 → 역 도보 스냅 최대 거리 (km). 초과 시 그 역으로 접근 불가. */
  walkMaxKm: number;
  /** 출발/도착에서 후보로 삼을 최근접 역 개수 */
  maxAccessStations: number;
  /** 승하차 고정 오버헤드(분) — 출발역 진입+도착역 진출 (계단·게이트). */
  boardingOverheadMin: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  transferPenaltyMin: 4,
  defaultRideMinutes: 2.5,
  walkSpeedKmH: 4,
  walkMaxKm: 1.2,
  maxAccessStations: 3,
  boardingOverheadMin: 4,
};

export interface RouteResult {
  /** 총 소요분 (도보 + 승하차 + 승차 + 환승) */
  minutes: number;
  /** 환승 횟수 */
  transfers: number;
}

interface Edge {
  to: number; // node index
  weight: number; // minutes
  kind: 'ride' | 'transfer';
}

/** WGS84 Haversine (km) — odsay.haversineKm 와 동일 공식(엔진 자립 위해 로컬 정의). */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export class SubwayRouter {
  private readonly cfg: RouterConfig;
  private readonly stations: SubwayStation[];
  /** node index → 인접 엣지 */
  private readonly adj: Edge[][];

  constructor(data: SubwayGraphData, config: Partial<RouterConfig> = {}) {
    this.cfg = { ...DEFAULT_ROUTER_CONFIG, ...config };
    this.stations = data.stations;

    const idToIdx = new Map<string, number>();
    this.stations.forEach((s, i) => idToIdx.set(s.id, i));

    this.adj = this.stations.map(() => []);

    // ride edges (양방향)
    for (const r of data.rides) {
      const a = idToIdx.get(r.fromId);
      const b = idToIdx.get(r.toId);
      if (a == null || b == null) continue; // 미상 역 id 무시
      const w = r.minutes ?? this.cfg.defaultRideMinutes;
      this.adj[a].push({ to: b, weight: w, kind: 'ride' });
      this.adj[b].push({ to: a, weight: w, kind: 'ride' });
    }

    // transfer edges — 같은 transferKey 그룹 내 모든 노드쌍 연결
    const groups = new Map<string, number[]>();
    this.stations.forEach((s, i) => {
      if (!s.transferKey) return;
      if (!groups.has(s.transferKey)) groups.set(s.transferKey, []);
      groups.get(s.transferKey)!.push(i);
    });
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const w = this.cfg.transferPenaltyMin;
          this.adj[idxs[i]].push({ to: idxs[j], weight: w, kind: 'transfer' });
          this.adj[idxs[j]].push({ to: idxs[i], weight: w, kind: 'transfer' });
        }
      }
    }
  }

  /** 좌표에서 walkMaxKm 내 최근접 역 후보 (도보분 포함), 가까운 순 maxAccessStations 개 */
  private accessStations(p: LatLng): { idx: number; walkMin: number }[] {
    const within = this.stations
      .map((s, idx) => ({ idx, km: haversineKm(p, s) }))
      .filter((x) => x.km <= this.cfg.walkMaxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, this.cfg.maxAccessStations);
    return within.map((x) => ({
      idx: x.idx,
      walkMin: (x.km / this.cfg.walkSpeedKmH) * 60,
    }));
  }

  /**
   * 출발 좌표 → 도착 좌표 지하철 통근 (소요분, 환승수).
   *  둘 다 도보권 역이 없거나 경로가 끊기면 null (호출자가 다른 폴백 사용).
   */
  route(origin: LatLng, dest: LatLng): RouteResult | null {
    const starts = this.accessStations(origin);
    const goals = this.accessStations(dest);
    if (starts.length === 0 || goals.length === 0) return null;

    const goalWalk = new Map<number, number>();
    for (const g of goals) goalWalk.set(g.idx, g.walkMin);

    const N = this.stations.length;
    const dist = new Array<number>(N).fill(Infinity);
    const prev = new Array<number>(N).fill(-1);
    const prevKind = new Array<Edge['kind'] | null>(N).fill(null);

    // 다익스트라 — 출발 후보들을 도보분으로 초기화 (멀티 소스)
    // 간단 우선순위큐 (배열 기반; 수도권 ~750 노드 규모엔 충분)
    const pq: { node: number; d: number }[] = [];
    const push = (node: number, d: number) => {
      pq.push({ node, d });
    };
    const popMin = (): { node: number; d: number } | null => {
      if (pq.length === 0) return null;
      let mi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[mi].d) mi = i;
      return pq.splice(mi, 1)[0];
    };

    for (const s of starts) {
      if (s.walkMin < dist[s.idx]) {
        dist[s.idx] = s.walkMin;
        push(s.idx, s.walkMin);
      }
    }

    let bestGoal = -1;
    let bestTotal = Infinity;

    while (pq.length > 0) {
      const cur = popMin();
      if (!cur) break;
      if (cur.d > dist[cur.node]) continue; // stale

      // 이 노드가 도착 도보권이면 총 소요 후보 갱신
      const gw = goalWalk.get(cur.node);
      if (gw != null) {
        const total = cur.d + gw;
        if (total < bestTotal) {
          bestTotal = total;
          bestGoal = cur.node;
        }
      }
      // 이미 찾은 최선보다 멀면 가지치기
      if (cur.d >= bestTotal) continue;

      for (const e of this.adj[cur.node]) {
        const nd = cur.d + e.weight;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = cur.node;
          prevKind[e.to] = e.kind;
          push(e.to, nd);
        }
      }
    }

    if (bestGoal === -1 || !isFinite(bestTotal)) return null;

    // 환승수 = 경로상 transfer 엣지 수
    let transfers = 0;
    for (let n = bestGoal; prev[n] !== -1; n = prev[n]) {
      if (prevKind[n] === 'transfer') transfers++;
    }

    return {
      minutes: Math.round(bestTotal + this.cfg.boardingOverheadMin),
      transfers,
    };
  }
}
