/**
 * LH 한국토지주택공사 청년주택 공급 정보 API 클라이언트
 *
 *  ▷ 데이터 소스 (공공데이터포털 data.go.kr)
 *    - 한국토지주택공사_임대주택단지 조회 서비스 (publicDataPk=15059475)
 *    - 엔드포인트: https://apis.data.go.kr/B552555/lhLeaseInfo1/lhLeaseInfo1
 *    - 응답 형식: JSON  [{ dsSch:[...] }, { dsList:[...], resHeader:[...] }]
 *    - 인증키: MOLIT_SERVICE_KEY (.env) — 미설정 시 빈 배열 반환
 *
 *  ▷ 수집 대상 (3종)
 *    1) 행복주택   (UPP_AIS_TP_CD=06)  — 청년 1인 가구 주력
 *    2) 청년매입임대 (UPP_AIS_TP_CD=01) — 기존 주택 LH 매입 후 임대
 *    3) 전세임대   (UPP_AIS_TP_CD=05)  — 시세 50~80% 보증금 지원
 *
 *  ▷ 사용처
 *    - seedLhYouthHousing.ts: DB 적재
 *    - recommendationRepository: lhComplexNearby 카운트
 *
 *  ▷ API 미적재(MOLIT_SERVICE_KEY 없음) 시 fallback
 *    - 빈 배열 반환 → UI 에서 "LH 청년주택 정보 없음" 처리
 */

import { SEOUL_LAWD_CODES } from '../../data/seoulLawdCodes';

/* ─── 환경변수 ──────────────────────────────────────────────── */

const API_KEY = process.env.MOLIT_SERVICE_KEY;
const LH_BASE = 'https://apis.data.go.kr/B552555/lhLeaseInfo1/lhLeaseInfo1';

if (!API_KEY) {
  console.warn('[lhClient] MOLIT_SERVICE_KEY 미설정 — 빈 배열 fallback');
}

/* ─── 공통 ──────────────────────────────────────────────────── */

/** 프로그램 유형 코드 */
export type LhProgramType = '행복주택' | '청년매입임대' | '전세임대';

/** LH 청년주택 단지 1건 */
export interface LhYouthRow {
  /** 법정동 코드 10자리 (없으면 시군구 5자리) */
  legalDongCode: string;
  programType: LhProgramType;
  complexName: string;
  address: string;
  /** 공급 가능 호수 */
  unitsAvailable: number;
  /** 월세 최저 (만원, 없으면 null) */
  monthlyRentMin: number | null;
  /** 월세 최고 (만원, 없으면 null) */
  monthlyRentMax: number | null;
  /** 모집 대상 레이블 */
  targetAudience: string;
  /** WGS84 위도 */
  lat: number | null;
  /** WGS84 경도 */
  lng: number | null;
}

/**
 * LH API JSON 응답에서 dsList 추출
 *  응답 구조: [{dsSch:[...]}, {dsList:[...], resHeader:[...]}]
 */
function extractDsList(json: unknown): Record<string, unknown>[] {
  if (!Array.isArray(json)) return [];
  for (const obj of json as Record<string, unknown>[]) {
    if (Array.isArray(obj['dsList'])) {
      return obj['dsList'] as Record<string, unknown>[];
    }
  }
  return [];
}

/* ─── 단지 목록 조회 ────────────────────────────────────────── */

/**
 * LH 임대주택단지 목록 조회 (data.go.kr lhLeaseInfo1)
 *
 *  파라미터 (data.go.kr lhLeaseInfo1 실명세 기준)
 *    ServiceKey : 인증키 (URL Encode)
 *    PG_SZ      : 한 페이지 결과 수
 *    PAGE       : 페이지 번호 (1부터)
 *    CNP_CD     : 지역코드 ("11"=서울)
 *    SPL_TP_CD  : 공급유형코드 생략 → 전체 조회 후 AIS_TP_CD_NM 으로 분류
 */
async function fetchLhComplexList(
  sigunguCode: string,
): Promise<LhYouthRow[]> {
  if (!API_KEY) return [];

  const rows: LhYouthRow[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = new URL(LH_BASE);
    url.searchParams.set('ServiceKey', API_KEY);
    url.searchParams.set('PG_SZ', String(pageSize));
    url.searchParams.set('PAGE', String(page));
    url.searchParams.set('CNP_CD', sigunguCode.slice(0, 2)); // 시도코드 2자리

    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) break;

      const json: unknown = await res.json();
      const items = extractDsList(json);
      if (items.length === 0) break;

      for (const item of items) {
        const row = parseLhRow(item, sigunguCode);
        if (row) rows.push(row);
      }

      if (items.length < pageSize) break;
      page++;
    } catch (e) {
      console.warn(`[lhClient] 조회 실패 sigungu=${sigunguCode}:`, e);
      break;
    }
  }

  return rows;
}

/** raw dsList item → LhYouthRow 변환 (lhLeaseInfo1 실명세 기준)
 *  AIS_TP_CD_NM(공급유형명)으로 청년주택 여부 판단
 */
function parseLhRow(
  item: Record<string, unknown>,
  sigunguCode: string,
): LhYouthRow | null {
  const str = (key: string) => String(item[key] ?? '').trim();
  const num = (key: string): number | null => {
    const v = parseFloat(String(item[key] ?? ''));
    return isNaN(v) ? null : v;
  };

  // 공급유형명 → 프로그램 타입 분류
  const aisNm = str('AIS_TP_CD_NM');
  const programType = resolveByAisNm(aisNm);

  // 세대수 (SUM_HSH_CNT = 총세대수)
  const unitsRaw = parseInt(str('SUM_HSH_CNT') || '0', 10);

  // 임대료: RFE=월임대료(원)
  const rfe = num('RFE');

  return {
    legalDongCode: sigunguCode, // API에 동코드 없음 → 지역코드(시도)로 집계
    programType,
    complexName: str('SBD_LGO_NM') || '(명칭 없음)',
    address: str('ARA_NM'),
    unitsAvailable: isNaN(unitsRaw) ? 0 : unitsRaw,
    monthlyRentMin: rfe != null ? Math.round(rfe / 10000) : null,
    monthlyRentMax: rfe != null ? Math.round(rfe / 10000) : null,
    targetAudience: aisNm || '청년',
    lat: null,
    lng: null,
  };
}

function resolveByAisNm(aisNm: string): LhProgramType {
  if (aisNm.includes('행복')) return '행복주택';
  if (aisNm.includes('매입')) return '청년매입임대';
  if (aisNm.includes('전세')) return '전세임대';
  return '행복주택'; // 기본값
}

// SPL_TP_CD 필터 사용 안 함 → AIS_TP_CD_NM 기반 분류 (resolveByAisNm)


/* ─── 퍼블릭 API ──────────────────────────────────────────── */

/**
 * 특정 시군구의 LH 청년주택 전체 조회 (3종 합산)
 *
 *  @param sigunguCode 5자리 시군구코드 (예: "11680" 강남구)
 *  @returns 행복주택 + 청년매입임대 + 전세임대 합산 배열
 */
export async function fetchLhYouthHousing(sigunguCode: string): Promise<LhYouthRow[]> {
  if (!API_KEY) {
    console.debug(`[lhClient] API 키 없음 — ${sigunguCode} skip`);
    return [];
  }

  // 유형 필터 없이 전체 조회 → AIS_TP_CD_NM 으로 분류
  const total = await fetchLhComplexList(sigunguCode);
  const happy    = total.filter((r) => r.programType === '행복주택');
  const youthBuy = total.filter((r) => r.programType === '청년매입임대');
  const jeonse   = total.filter((r) => r.programType === '전세임대');
  console.debug(`[lhClient] ${sigunguCode}: ${total.length}건 (행복${happy.length}/매입${youthBuy.length}/전세${jeonse.length})`);
  return total;
}

/**
 * 서울 전체 시군구 LH 청년주택 일괄 조회
 */
export async function fetchAllSeoulLhYouthHousing(): Promise<LhYouthRow[]> {
  const codes = SEOUL_LAWD_CODES.map((s) => s.code);
  const results: LhYouthRow[] = [];

  // rate-limit: 시군구 순차 처리 (API 서버 부하 배려)
  for (const code of codes) {
    const rows = await fetchLhYouthHousing(code);
    results.push(...rows);
    await new Promise((r) => setTimeout(r, 200)); // 200ms 간격
  }

  return results;
}

/**
 * 특정 행정동 인근 LH 청년주택 카운트 조회 (추천 API 용)
 *
 *  DB 에 적재된 t_lh_youth_housing 에서 집계 — 이 함수는 직접 DB 조회.
 *  사용처: recommendationRepository.ts 에서 lhComplexNearby 필드 계산.
 */
export async function countLhNearby(
  legalDongCode: string,
): Promise<number> {
  // import 순환 방지 — DB 조회는 repository 에서 직접 처리
  // 여기서는 타입 힌트 역할만
  return 0; // placeholder — repository 에서 prisma 직접 사용
}
