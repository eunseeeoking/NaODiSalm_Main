/**
 * 지하철 노선 그래프 적재 — odsay 통근 분석 §7.2/§7.3 (① 데이터 소싱 → ② 라우터 입력).
 *
 *  입력 (KRIC 레일포털 / data.go.kr 전국도시철도 표준데이터, `server/data/`):
 *    · 전체_도시철도역사정보_*.xlsx   (15013205) — 역 좌표·노선·환승
 *    · 전체_도시철도운행정보_*.xlsx   (15013206) — 열차별 정거장 순서·구간 시각
 *  출력:
 *    · server/data/subway-graph.json  — SubwayGraphData (stations + rides), 라우터가 로드.
 *
 *  변환:
 *    노드   = (노선번호, 역사명) 단위. 좌표/노선명 = 역사정보.
 *    transfer = 같은 역사명 + 근접(≤TRANSFER_MAX_KM) + 서로 다른 노선 ≥2 → 동일 transferKey.
 *    ride edge = 운행정보에서 운행유형='일반'(완행) 열차의 **연속 정거장** 쌍. (급행은 정차 건너뛰어 제외.)
 *                구간 소요분 = (다음역 도착시각 − 현재역 출발시각) × 1440. 같은 구간 여러 열차 → 중앙값.
 *
 *  ⚠️ 조인 주의(실측 진단): 두 표준데이터의 **노선번호·노선명·정거장명이 서로 다른 코딩**을 쓴다
 *    (운행 "서울 도시철도 7호선"/"경광주" ↔ 역사 "7호선"/"경기광주역"). 그래서 노선코드·노선명으로
 *    조인하면 대부분 미매칭. → **역명("역" 접미사 제거)으로 후보를 찾고, 같은 run은 한 노선이므로
 *    연속 정거장 후보쌍 중 지리적으로 가장 인접한 쌍을 채택**(환승역 동명 모호성·노선코드 불일치 동시 우회).
 *    운행이 약칭을 쓰는 일부 역(KORAIL 경강선 등)은 미매칭 → 해당 구간 누락(커버리지 로그로 보고).
 *
 *  실행: cd server && npx tsx scripts/seedSubwayGraph.ts
 *    (라이브러리: xlsx — devDependency. DB 불필요, 정적 JSON 생성.)
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import type { SubwayStation, RideSegment } from '../src/services/commute/subwayRouter';

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATION_FILE = '전체_도시철도역사정보_20260228.xlsx';
const OPERATION_FILE = '전체_도시철도운행정보_20260228.xlsx';
const OUT_FILE = path.join(DATA_DIR, 'subway-graph.json');

const TRANSFER_MAX_KM = 1.0;     // 동일역명이 이보다 멀면 다른 물리역(이름충돌)으로 간주
const MAX_SEGMENT_MIN = 20;      // 구간 소요분 상한(이상치 컷)
// 연속 정거장 채택 거리 상한. run 노선고정 해소가 있어 오매칭 위험이 낮으므로 넉넉히.
//  6km 면 신분당 판교~청계산입구(청계산터널 ~7km)·경춘선 등 실제 장구간이 잘렸음 → 15km.
const MAX_ADJ_KM = 15;
const ALLSTOP_TYPES = new Set(['일반']); // 인접 도출에 쓸 운행유형(완행). 급행/특급 제외.

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const nodeId = (lineCode: string, name: string) => `${lineCode}|${name}`;
/** 역명 정규화 — 접미사 "역" 제거 + 괄호주석 제거 + 공백정리. 두 데이터셋 정거장명 조인 키. */
const normStation = (s: unknown): string =>
  norm(s).replace(/\(.*?\)/g, '').replace(/역$/, '').replace(/\s+/g, ' ').trim();

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface StationRow {
  역번호: unknown; 역사명: unknown; 노선번호: unknown; 노선명: unknown;
  환승역구분: unknown; 역위도: unknown; 역경도: unknown;
}
interface OperationRow {
  열차번호: unknown; 노선번호: unknown; 노선명: unknown; 운행유형: unknown; 요일구분: unknown;
  운행구간정거장: unknown; 정거장도착시각: unknown; 정가장출발시각: unknown;
}

function main() {
  // ── 1) 역사정보 → 노드 ──────────────────────────────────────────
  console.log('역사정보 읽는 중…');
  const stWb = XLSX.readFile(path.join(DATA_DIR, STATION_FILE));
  const stRows = XLSX.utils.sheet_to_json<StationRow>(stWb.Sheets[stWb.SheetNames[0]], { defval: null });

  interface NodeTmp extends SubwayStation { isTransferFlag: boolean }
  const nodes = new Map<string, NodeTmp>();
  let skippedNoCoord = 0;
  for (const r of stRows) {
    const lineCode = norm(r.노선번호);
    const name = norm(r.역사명);
    const lat = typeof r.역위도 === 'number' ? r.역위도 : parseFloat(String(r.역위도));
    const lng = typeof r.역경도 === 'number' ? r.역경도 : parseFloat(String(r.역경도));
    if (!lineCode || !name || !isFinite(lat) || !isFinite(lng)) { skippedNoCoord++; continue; }
    const id = nodeId(lineCode, name);
    if (nodes.has(id)) continue; // 동일 (노선,역) 중복 행 제거
    nodes.set(id, {
      id, name, line: norm(r.노선명) || lineCode, lat, lng,
      isTransferFlag: norm(r.환승역구분) === '환승역',
    });
  }
  console.log(`  역 노드 ${nodes.size}개 (좌표누락 등 skip ${skippedNoCoord})`);

  // ── 2) 환승 그룹 — 같은 역사명 + 근접 클러스터 (노선 ≥2) ─────────
  //  ⚠️ 정규화 역명으로 그룹핑 — raw 역사명은 같은 환승역도 접미사/괄호가 달라("정자" vs "정자역",
  //     "온수역" vs "온수(성공회대입구)") 안 묶임 → 7호선·신분당·분당선이 본체와 단절됐었음.
  const byName = new Map<string, NodeTmp[]>();
  for (const n of nodes.values()) {
    const k = normStation(n.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(n);
  }
  let transferGroups = 0;
  let collisionWarns = 0;
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    // 근접 클러스터링 (이름충돌 방어): 첫 노드 기준 TRANSFER_MAX_KM 내를 한 클러스터로
    const used = new Array(group.length).fill(false);
    let clusterIdx = 0;
    for (let i = 0; i < group.length; i++) {
      if (used[i]) continue;
      const cluster = [group[i]]; used[i] = true;
      for (let j = i + 1; j < group.length; j++) {
        if (used[j]) continue;
        if (haversineKm(group[i], group[j]) <= TRANSFER_MAX_KM) { cluster.push(group[j]); used[j] = true; }
      }
      const lines = new Set(cluster.map((c) => c.line));
      if (cluster.length >= 2 && lines.size >= 2) {
        const key = `${name}#${clusterIdx}`;
        cluster.forEach((c) => { c.transferKey = key; });
        transferGroups++;
      }
      clusterIdx++;
    }
    if (clusterIdx > 1) collisionWarns++; // 같은 이름이 떨어진 물리역으로 쪼개진 경우
  }
  console.log(`  환승 그룹 ${transferGroups}개 (동일역명 분리 클러스터 발생 ${collisionWarns}건)`);

  // 역명(정규화) → 역사 노드 후보 인덱스 (조인 키)
  const nameIndex = new Map<string, NodeTmp[]>();
  for (const n of nodes.values()) {
    const k = normStation(n.name);
    if (!nameIndex.has(k)) nameIndex.set(k, []);
    nameIndex.get(k)!.push(n);
  }

  // ── 3) 운행정보 → ride edge (완행 연속 정거장, 역명+거리 조인) ──
  console.log('운행정보 읽는 중… (대용량, 수십초 가능)');
  const opWb = XLSX.readFile(path.join(DATA_DIR, OPERATION_FILE));
  const opRows = XLSX.utils.sheet_to_json<OperationRow>(opWb.Sheets[opWb.SheetNames[0]], { defval: null });
  console.log(`  운행 행 ${opRows.length}개`);

  const typeCounts = new Map<string, number>();
  for (const r of opRows) typeCounts.set(norm(r.운행유형), (typeCounts.get(norm(r.운행유형)) ?? 0) + 1);
  console.log('  운행유형 분포:', [...typeCounts.entries()].map(([k, v]) => `${k}:${v}`).join(', '));

  // 한 파일에 두 포맷 혼재:
  //  · Format A (KORAIL 등): 1행=1정거장, 시각=Excel 분수(일). run 내 연속 행이 인접.
  //  · Format B (서울교통공사): 1행=전체노선, 정거장="001-성수+002-용답+…", 시각="001-HH:MM+…".
  const segMinutes = new Map<string, number[]>();      // "idA~~idB"(정렬) → minutes[]
  const segPairNodes = new Map<string, [string, string]>();
  let unmatchedName = 0;
  let tooFar = 0;

  /** "HH:MM" → 분 (00:00 sentinel/이상 → null) */
  const parseHHMM = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return null;
    const min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return min > 0 ? min : null;
  };
  // 순서 접두사 제거: "001-성수"·"D19-광교"·"3125-예술회관" 등 ([문자]*숫자-). 신분당=D-, 인천=숫자-.
  const stripSeq = (t: string) => t.replace(/^[A-Za-z]*\d+\s*-\s*/, '').trim();
  // Format B 구분자 — 서울="+", 인천=",". 단 역명 내부 콤마("아라(북부법원, 검찰청)")는 보존 위해
  //  **다음 토큰의 순서접두사 앞에서만** 분리.
  const SEP = /[+,]\s*(?=[A-Za-z]*\d+\s*-)/;

  /**
   * run(한 열차=한 노선) 단위 처리 — **run 전체를 지배적 역사 노선명으로 고정** 해소.
   *  동일위치 환승노드(예: 신분당 강남 vs 2호선 강남)에서 최근접쌍이 엉뚱한 노선을 골라
   *  노선 체인이 깨지던 문제 방지. run 정거장들이 공유하는 노선명이 곧 그 노선.
   *  @param names   정규화 역명 순서
   *  @param segMins names[i]→[i+1] 구간분 (없으면 undefined → 기본값)
   */
  const addRun = (names: string[], segMins: (number | undefined)[]): void => {
    const cands = names.map((n) => nameIndex.get(n) ?? []);
    // 지배적 역사 노선명 (정거장 커버 수 최대)
    const lineCount = new Map<string, number>();
    for (const cs of cands) {
      for (const L of new Set(cs.map((c) => c.line))) lineCount.set(L, (lineCount.get(L) ?? 0) + 1);
    }
    let domLine = ''; let domN = -1;
    for (const [L, n] of lineCount) if (n > domN) { domN = n; domLine = L; }

    // 각 정거장 → 지배노선 노드 우선, 없으면 인접 해소노드에 최근접
    const resolved: (NodeTmp | null)[] = cands.map((cs) => cs.find((c) => c.line === domLine) ?? null);
    for (let i = 0; i < resolved.length; i++) {
      if (resolved[i] || cands[i].length === 0) continue;
      let ref: NodeTmp | null = null;
      for (let j = i - 1; j >= 0 && !ref; j--) ref = resolved[j];
      for (let j = i + 1; j < resolved.length && !ref; j++) ref = resolved[j];
      if (ref) {
        let best = cands[i][0]; let bk = haversineKm(ref, best);
        for (const c of cands[i]) { const d = haversineKm(ref, c); if (d < bk) { bk = d; best = c; } }
        resolved[i] = best;
      } else resolved[i] = cands[i][0];
    }

    for (let i = 0; i + 1 < names.length; i++) {
      const a = resolved[i], b = resolved[i + 1];
      if (!a || !b) { unmatchedName++; continue; }
      if (a.id === b.id) continue;
      if (haversineKm(a, b) > MAX_ADJ_KM) { tooFar++; continue; }
      const [x, y] = [a.id, b.id].sort();
      const key = `${x}~~${y}`;
      if (!segMinutes.has(key)) { segMinutes.set(key, []); segPairNodes.set(key, [x, y]); }
      const m = segMins[i];
      if (m != null && m > 0 && m <= MAX_SEGMENT_MIN) segMinutes.get(key)!.push(m);
    }
  };

  // Format A run 버퍼링 (연속 동일 runKey 행을 모음)
  let curKey = '';
  let bufNames: string[] = [];
  let bufDep: number[] = []; // 각 정거장 출발시각(Excel 분수)
  const flushA = () => {
    if (bufNames.length >= 2) {
      // 구간분 = 다음역 출발 − 현재역 출발 (Format A 는 도착시각 미보관 → 출발차로 근사, 정차 무시).
      const segs: (number | undefined)[] = new Array(bufNames.length).fill(undefined);
      for (let i = 0; i + 1 < bufNames.length; i++) {
        segs[i] = isFinite(bufDep[i + 1]) && isFinite(bufDep[i]) ? (bufDep[i + 1] - bufDep[i]) * 1440 : undefined;
      }
      addRun(bufNames, segs);
    }
    bufNames = []; bufDep = [];
  };

  for (const r of opRows) {
    if (!ALLSTOP_TYPES.has(norm(r.운행유형))) { flushA(); curKey = ''; continue; } // 급행 등 제외
    const raw = norm(r.운행구간정거장);
    const isFormatB = /^[A-Za-z]*\d+\s*-/.test(raw); // 순서접두사로 시작하면 전체노선 1행(서울/인천)

    if (isFormatB) {
      flushA(); curKey = '';
      const names = raw.split(SEP).map(stripSeq).map(normStation);
      const arrs = norm(r.정거장도착시각).split(SEP).map((t) => parseHHMM(stripSeq(t)));
      const deps = norm(r.정가장출발시각).split(SEP).map((t) => parseHHMM(stripSeq(t)));
      const segs: (number | undefined)[] = names.map((_, i) => {
        const dep = deps[i], arrNext = arrs[i + 1];
        if (dep == null || arrNext == null) return undefined;
        let d = arrNext - dep; if (d < 0) d += 24 * 60;
        return d;
      });
      addRun(names, segs);
      continue;
    }

    // Format A
    const runKey = `${norm(r.열차번호)}|${norm(r.요일구분)}|${norm(r.노선번호)}`;
    if (runKey !== curKey) { flushA(); curKey = runKey; }
    bufNames.push(normStation(r.운행구간정거장));
    bufDep.push(typeof r.정가장출발시각 === 'number' ? r.정가장출발시각 : NaN);
  }
  flushA();

  const rides: RideSegment[] = [];
  for (const [key, mins] of segMinutes) {
    const [a, b] = segPairNodes.get(key)!;
    // 시간 표본 없으면 minutes 생략 → 라우터 defaultRideMinutes 사용
    rides.push({ fromId: a, toId: b, minutes: mins.length ? Math.round(median(mins) * 10) / 10 : undefined });
  }
  const avgSamp = ([...segMinutes.values()].reduce((s, m) => s + m.length, 0)) / Math.max(1, segMinutes.size);
  console.log(`  ride edge ${rides.length}개 (구간당 평균 표본 ${avgSamp.toFixed(1)} | 역명 미매칭 transition ${unmatchedName} | 거리초과 ${tooFar})`);

  // ── 4) 그래프 노드 중 ride 에 안 쓰인 고립역 제거(선택) 없이 전체 출력 ──
  const stations: SubwayStation[] = [...nodes.values()].map(({ isTransferFlag: _f, ...s }) => s);

  // 연결성 점검: ride 에 등장한 노드 수
  const connected = new Set<string>();
  for (const e of rides) { connected.add(e.fromId); connected.add(e.toId); }
  console.log(`  ride 로 연결된 노드 ${connected.size}/${stations.length} (고립 ${stations.length - connected.size})`);

  fs.writeFileSync(OUT_FILE, JSON.stringify({ stations, rides }, null, 0), 'utf-8');
  console.log(`\n💾 저장: ${OUT_FILE}  (stations ${stations.length}, rides ${rides.length})`);
}

main();
