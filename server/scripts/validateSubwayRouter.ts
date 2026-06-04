/**
 * 라우터 실데이터 검증 — 삼산동/소사본동 등 알려진 케이스 (odsay 분석 §7.3, ② 검증).
 *  subway-graph.json 로드 → 실 좌표로 라우터 실행 → 직선추정·(있으면) ODsay 실측과 대조.
 *  실행: cd server && npx tsx scripts/validateSubwayRouter.ts
 */
import { SubwayRouter } from '../src/services/commute/subwayRouter';
import { loadSubwayGraph } from '../src/services/commute/subwayGraphLoader';

const graph = loadSubwayGraph();
if (!graph) { console.error('subway-graph.json 없음/손상 — seed:subway-graph 먼저.'); process.exit(1); }
console.log(`그래프: stations ${graph.stations.length}, rides ${graph.rides.length}`);

// 핵심 역 존재/연결 점검
const connected = new Set<string>();
for (const e of graph.rides) { connected.add(e.fromId); connected.add(e.toId); }
const keyStations = ['삼산체육관', '부평구청', '부평', '소사', '부천', '송내', '신도림', '구로', '정자', '강남', '서울역'];
console.log('\n핵심 역 연결 상태:');
for (const name of keyStations) {
  const matches = graph.stations.filter((s) => s.name.replace(/\(.*?\)/g, '').replace(/역$/, '').trim() === name);
  const conn = matches.filter((m) => connected.has(m.id));
  console.log(`  ${name.padEnd(8)} 노드 ${matches.length} (연결 ${conn.length}) ${matches.map((m) => m.line).join(',')}`);
}

const router = new SubwayRouter(graph, { transferPenaltyMin: 4, walkMaxKm: 1.5, boardingOverheadMin: 4 });

function estimateStraight(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(x));
  return Math.round(km / 0.42 + 5); // §8-4 단일 직선 추정공식
}

// 동 centroid(근사) — workplace 별 비교
interface Case { label: string; lat: number; lng: number }
const dongs: Case[] = [
  { label: '삼산동(인천부평/인천1호선)', lat: 37.5076, lng: 126.741 },
  { label: '소사본동(부천소사/1호선·서해선)', lat: 37.4815, lng: 126.7951 },
  { label: '정자동(분당/신분당)', lat: 37.3668, lng: 127.1083 },
];
const workplaces: Case[] = [
  { label: '서울역', lat: 37.5547, lng: 126.9707 },
  { label: '강남역', lat: 37.4979, lng: 127.0276 },
];

for (const wp of workplaces) {
  console.log(`\n${'='.repeat(70)}\n📍 직장=${wp.label}`);
  console.log('동                              직선추정  라우터(분/환승)');
  for (const d of dongs) {
    const straight = estimateStraight(d.lat, d.lng, wp.lat, wp.lng);
    const r = router.route({ lat: d.lat, lng: d.lng }, { lat: wp.lat, lng: wp.lng });
    const routerStr = r ? `${r.minutes}분/환승${r.transfers}` : '경로없음(도보권역 없음/비연결)';
    console.log(`  ${d.label.padEnd(30)} ${String(straight).padStart(4)}분    ${routerStr}`);
  }
}
