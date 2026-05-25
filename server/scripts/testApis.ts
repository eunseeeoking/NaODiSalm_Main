/**
 * API 연동 테스트 스크립트 (활용신청 완료 후 1회 실행)
 *
 *  실행:
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npx tsx scripts/testApis.ts
 *
 *  확인 항목:
 *    [1] TAGO 버스정류장 조회 (getCrdntPrxmtSttnList)
 *    [2] TAGO 버스노선 조회 (getSttnThrghRouteList)
 *    [3] LH 임대주택단지 조회 (lhLeaseInfo1)
 *    [4] LH 공공임대주택 단지정보 (15058476)
 */
import 'dotenv/config';
import { XMLParser } from 'fast-xml-parser';

const KEY = process.env.MOLIT_SERVICE_KEY;
const PARSER = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });

if (!KEY) {
  console.error('[ERROR] MOLIT_SERVICE_KEY 미설정');
  process.exit(1);
}

/* ─── 헬퍼 ──────────────────────────────────────────────────── */

async function get(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return { status: res.status, text: await res.text() };
}

function extractItems(parsed: unknown): unknown[] {
  const p = parsed as Record<string, unknown>;
  const resp  = p['response']  as Record<string, unknown> | undefined;
  const body  = resp?.['body']  as Record<string, unknown> | undefined;
  const items = body?.['items'] as Record<string, unknown> | undefined;
  const item  = items?.['item'];
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function ok(label: string, msg: string) { console.log(`  ✅ ${label}: ${msg}`); }
function ng(label: string, msg: string) { console.log(`  ❌ ${label}: ${msg}`); }

/* ─── 테스트 케이스 ─────────────────────────────────────────── */

// [1] TAGO 버스정류장 (강남역 좌표)
async function testTagoStations() {
  console.log('\n[1] TAGO 버스정류장 조회');
  const url = `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList`
    + `?serviceKey=${KEY}&gpsLati=37.4979&gpsLong=127.0276&count=5&_type=xml`;
  try {
    const { status, text } = await get(url);
    console.log(`  HTTP ${status}, 응답 길이: ${text.length}bytes`);
    if (status !== 200) { ng('status', `${status}`); return; }

    const parsed = PARSER.parse(text);
    const items = extractItems(parsed);
    if (items.length > 0) {
      ok('item 수', `${items.length}개`);
      const first = items[0] as Record<string, unknown>;
      console.log('  첫 번째 정류장 필드:', Object.keys(first).join(', '));
      console.log(`    nodeid=${first['nodeid']} nodenm=${first['nodenm']} gpslati=${first['gpslati']} gpslong=${first['gpslong']}`);
      console.log(`    citycode=${first['citycode']}`);  // ← 도시코드 값 확인
      // 전체 정류장 citycode 목록
      console.log('  전체 citycode 목록:', (items as Record<string, unknown>[]).map(i => i['citycode']).join(', '));
    } else {
      const rc = (parsed as Record<string, unknown>);
      ng('item 없음', JSON.stringify(rc).slice(0, 200));
    }
  } catch (e) {
    ng('에러', String(e));
  }
}

// [2] TAGO 버스노선 — cityCode=23([1] 실측값), nodeId도 [1] 결과
async function testTagoRoutes(nodeId = 'ICB121000541', cityCode = '23'): Promise<string | null> {
  console.log(`\n[2] TAGO 버스노선 조회 (nodeId=${nodeId}, cityCode=${cityCode})`);
  const url = `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnThrghRouteList`
    + `?serviceKey=${KEY}&cityCode=${cityCode}&nodeid=${nodeId}&_type=xml`;
  try {
    const { status, text } = await get(url);
    console.log(`  HTTP ${status}, 응답 길이: ${text.length}bytes`);
    if (status !== 200) { ng('status', `${status}\n  ${text.slice(0,200)}`); return null; }

    const parsed = PARSER.parse(text);
    const items = extractItems(parsed);
    if (items.length > 0) {
      ok('노선 수', `${items.length}개`);
      const first = items[0] as Record<string, unknown>;
      console.log('  첫 번째 노선 필드:', Object.keys(first).join(', '));
      console.log(`    routeid=${first['routeid']} routenm=${first['routenm']}`);
      return String(first['routeid'] ?? '');
    } else {
      ng('item 없음', text.slice(0, 300));
      return null;
    }
  } catch (e) {
    ng('에러', String(e));
    return null;
  }
}

// [3] TAGO 노선 상세 — [2]에서 받은 routeId + cityCode 사용
async function testTagoRouteInfo(routeId = '100100118', cityCode = '23') {
  console.log(`\n[3] TAGO 노선 상세 조회 (routeId=${routeId}, cityCode=${cityCode})`);
  const url = `https://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteInfoIem`
    + `?serviceKey=${KEY}&cityCode=${cityCode}&routeId=${routeId}&_type=xml`;
  try {
    const { status, text } = await get(url);
    console.log(`  HTTP ${status}, 응답 길이: ${text.length}bytes`);
    if (status !== 200) { ng('status', `${status}`); return; }

    const parsed = PARSER.parse(text);
    const items = extractItems(parsed);
    if (items.length > 0) {
      ok('노선 정보', '조회 성공');
      const i = items[0] as Record<string, unknown>;
      console.log('  필드 목록:', Object.keys(i).join(', '));
      console.log(`    routenm=${i['routenm']}`);
      console.log(`    intervl=${i['intervl']} (배차간격 후보)`);
      console.log(`    startvehicletime=${i['startvehicletime']} endvehicletime=${i['endvehicletime']}`);
      console.log(`    firstbustime=${i['firstbustime']} lastbustime=${i['lastbustime']}`);
    } else {
      ng('item 없음', text.slice(0, 300));
    }
  } catch (e) {
    ng('에러', String(e));
  }
}

// [4] LH 임대주택단지 조회 — 타입별 실데이터 필드 확인
async function testLhLeaseInfo() {
  console.log('\n[4] LH 임대주택단지 조회 (lhLeaseInfo1)');
  const BASE = `https://apis.data.go.kr/B552555/lhLeaseInfo1/lhLeaseInfo1`;

  // SPL_TP_CD: 07=행복주택(추정), 01=매입임대, 05=전세임대
  // CNP_CD: 11=서울
  // PAGE: 페이지번호 (PG_NO 아님)
  const types: [string, string][] = [['07', '행복주택'], ['01', '매입임대'], ['05', '전세임대'], ['', '전체(필터없음)']];

  for (const [code, label] of types) {
    const params = new URLSearchParams({
      ServiceKey: KEY!,
      PG_SZ: '3',
      PAGE: '1',
      CNP_CD: '11',
    });
    if (code) params.set('SPL_TP_CD', code);
    const url = `${BASE}?${params.toString()}`;
    try {
      const { status, text } = await get(url);
      if (status !== 200) { console.log(`  [${label}] HTTP ${status}`); continue; }

      const json = JSON.parse(text) as unknown[];
      // dsList 추출
      let dsList: Record<string, unknown>[] = [];
      for (const obj of json as Record<string, unknown>[]) {
        if (Array.isArray(obj['dsList'])) { dsList = obj['dsList'] as Record<string, unknown>[]; break; }
      }

      if (dsList.length > 0) {
        ok(label, `dsList ${dsList.length}건`);
        console.log('  필드:', Object.keys(dsList[0]).join(', '));
        const f = dsList[0];
        // 주요 필드 샘플 출력
        ['CMPX_NM','AIS_NM','LGDN_ADR','ADR','LGDN_CD','BJDNG_CD',
         'TOT_HSH_CNT','TOT_UNT_CNT','RNT_MN_AMT','RNT_MX_AMT',
         'CTRT_LAT','CTRT_LNTD','LAT','LNG'].forEach((k) => {
          if (f[k] !== undefined) console.log(`    ${k}=${f[k]}`);
        });
      } else {
        console.log(`  [${label}] dsList 비어있음 (파라미터 확인 필요)`);
        // resHeader 확인
        for (const obj of json as Record<string, unknown>[]) {
          if (Array.isArray(obj['resHeader'])) {
            console.log('  resHeader:', JSON.stringify(obj['resHeader']));
          }
        }
      }
    } catch (e) {
      ng(label, String(e));
    }
  }
}

// [5] LH 분양임대공고문 조회 서비스 — 엔드포인트 탐색
async function testLhPublicRental() {
  console.log('\n[5] LH 분양임대공고문 조회 — 엔드포인트 탐색');

  const candidates = [
    `https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/lhLeaseNoticeSplInfo1`,
    `https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1`,
    `https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`,
  ];

  for (const base of candidates) {
    const url = `${base}?serviceKey=${encodeURIComponent(KEY!)}&PG_SZ=3&PG_NO=1`;
    try {
      const { status, text } = await get(url);
      const preview = text.slice(0, 120).replace(/\n/g, ' ');
      console.log(`  [${status}] ${base.replace('https://', '')}`);
      if (status === 200) {
        ok('200 성공!', `응답 ${text.length}bytes → ${preview}`);
        break;
      } else {
        console.log(`    응답: ${preview}`);
      }
    } catch (e) {
      console.log(`  [ERR] ${String(e).slice(0, 80)}`);
    }
  }
}

/* ─── 메인 ──────────────────────────────────────────────────── */

async function main() {
  console.log('====================================');
  console.log('  API 연동 테스트 (MOLIT_SERVICE_KEY)');
  console.log('====================================');
  console.log(`  KEY 앞 8자: ${KEY!.slice(0, 8)}...`);

  await testTagoStations();
  const routeId = await testTagoRoutes();   // [2]: cityCode=23, nodeId=ICB121000541
  await testTagoRouteInfo(routeId ?? undefined, '23');  // [3]: 동일 cityCode 전달
  await testLhLeaseInfo();
  await testLhPublicRental();

  console.log('\n====================================');
  console.log('  테스트 완료');
  console.log('  ❗ 위 결과에서 필드명 확인 후 lhClient.ts 업데이트 필요');
  console.log('====================================');
}

main().catch((e) => { console.error(e); process.exit(1); });
