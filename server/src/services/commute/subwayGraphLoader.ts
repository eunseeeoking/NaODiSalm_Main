/**
 * 지하철 그래프 로더 — 정적 JSON(`server/data/subway-graph.json`) → SubwayGraphData.
 *
 *  라우터는 DB 가 아니라 **정적 그래프**(작고 정적, 수도권 역 ~750·노선 ~23)를 메모리에 들고 동작.
 *  이 JSON 은 scripts/seedSubwayGraph.ts 가 전국도시철도 표준데이터(15013205+15013206, §7.2)로 생성.
 *  파일이 없으면(아직 미적재) null → 호출부가 직선거리 폴백 유지(점진적·무중단 도입).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SubwayGraphData, SubwayStation, RideSegment } from './subwayRouter';

/** 기본 경로 — server/data/subway-graph.json */
export const DEFAULT_GRAPH_PATH = path.join(__dirname, '..', '..', '..', 'data', 'subway-graph.json');

let _cached: SubwayGraphData | null | undefined; // undefined = 미시도, null = 없음/실패

/** 그래프 JSON 검증 — 최소 형태 보장 (적재 누락·손상 시 라우터 비활성, 폴백 유지) */
export function validateGraphData(raw: unknown): SubwayGraphData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { stations?: unknown; rides?: unknown };
  if (!Array.isArray(obj.stations) || !Array.isArray(obj.rides)) return null;

  const stations: SubwayStation[] = [];
  for (const s of obj.stations as Record<string, unknown>[]) {
    if (
      typeof s.id !== 'string' ||
      typeof s.name !== 'string' ||
      typeof s.line !== 'string' ||
      typeof s.lat !== 'number' ||
      typeof s.lng !== 'number'
    ) {
      return null; // 한 행이라도 형식 이상이면 전체 무효 (조용한 부분 그래프 방지)
    }
    stations.push({
      id: s.id,
      name: s.name,
      line: s.line,
      lat: s.lat,
      lng: s.lng,
      transferKey: typeof s.transferKey === 'string' ? s.transferKey : undefined,
    });
  }

  const rides: RideSegment[] = [];
  for (const r of obj.rides as Record<string, unknown>[]) {
    if (typeof r.fromId !== 'string' || typeof r.toId !== 'string') return null;
    rides.push({
      fromId: r.fromId,
      toId: r.toId,
      minutes: typeof r.minutes === 'number' ? r.minutes : undefined,
    });
  }

  if (stations.length === 0 || rides.length === 0) return null;
  return { stations, rides };
}

/** 그래프 JSON 로드(캐시). 파일 없음·손상 시 null. */
export function loadSubwayGraph(graphPath: string = DEFAULT_GRAPH_PATH): SubwayGraphData | null {
  if (_cached !== undefined) return _cached;
  try {
    if (!fs.existsSync(graphPath)) {
      _cached = null;
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    _cached = validateGraphData(raw);
    if (_cached === null) {
      console.warn(`[subway-graph] ${graphPath} 형식 이상 — 라우터 비활성(직선 폴백 유지).`);
    }
    return _cached;
  } catch (e) {
    console.warn('[subway-graph] 로드 실패 — 라우터 비활성:', e);
    _cached = null;
    return null;
  }
}

/** 테스트/재적재용 캐시 초기화 */
export function _resetSubwayGraphCache(): void {
  _cached = undefined;
}
