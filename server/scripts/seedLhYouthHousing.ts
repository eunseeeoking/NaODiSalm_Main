/**
 * LH 한국토지주택공사 청년주택 공급 정보 수집 스크립트 (Day 2 + Phase 2-B 보강 2026-05-27)
 *
 *  ▷ 목적
 *    LH 오픈 API → t_lh_youth_housing 테이블 단지 단위 적재
 *    Kakao Local API 로 주소→법정동 10자리 + 좌표 지오코딩
 *
 *  ▷ 식별 키 (Phase 2-B 보강 후)
 *    (legalDongCode, programType, complexName) — schema @@unique
 *    같은 단지 중복 응답을 단일 row 로 압축
 *
 *  ▷ 실행
 *    cd C:\git\2026_MOLIT_CONTEST\server
 *    npm run seed:lh                 # 증분 적재 (기존 row 보존)
 *    npm run seed:lh -- --reset      # 기존 row 전체 삭제 후 재적재
 *    npm run seed:lh -- --no-geocode # 지오코딩 비활성화 (시군구 5자리만)
 *
 *  ▷ 사전 조건
 *    - server/.env 에 MOLIT_SERVICE_KEY=<발급키>
 *    - server/.env 에 KAKAO_REST_API_KEY=<카카오 REST 키>
 *    - npx prisma db push   ← Phase 2-B schema 변경 후 필수
 *
 *  ▷ 결과 확인 (MySQL)
 *    SELECT
 *      LENGTH(legal_dong_code) AS digits,
 *      program_type,
 *      COUNT(*) AS rows_cnt,
 *      SUM(units_available) AS total_units
 *    FROM t_lh_youth_housing
 *    GROUP BY digits, program_type;
 */
import 'dotenv/config';
import { prisma } from '../src/services/db';
import { fetchLhYouthHousing, type LhYouthRow } from '../src/services/external/lhClient';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';
import { addressToLegalDongCode, type AddressResolveResult } from '../src/services/external/geocoder';

/* ─── CLI 옵션 파싱 ───────────────────────────────────────── */

const argv = process.argv.slice(2);
const OPT_RESET = argv.includes('--reset');
const OPT_NO_GEOCODE = argv.includes('--no-geocode');

/* ─── 지오코딩 캐시 (같은 주소 중복 호출 방지) ────────────── */

interface ResolvedAddr {
  legalDongCode: string;
  lat: number | null;
  lng: number | null;
}

const geocodeCache = new Map<string, ResolvedAddr | null>();
let geocodeHits = 0;
let geocodeMiss = 0;
let geocodeOk = 0;
let geocodeFail = 0;

async function resolveAddress(row: LhYouthRow): Promise<ResolvedAddr> {
  const fallback: ResolvedAddr = { legalDongCode: row.legalDongCode, lat: null, lng: null };

  if (OPT_NO_GEOCODE) return fallback;
  if (!process.env.KAKAO_REST_API_KEY) return fallback;
  if (!row.address) {
    geocodeMiss++;
    return fallback;
  }

  const cached = geocodeCache.get(row.address);
  if (cached !== undefined) {
    geocodeHits++;
    return cached ?? fallback;
  }

  try {
    const r: AddressResolveResult | null = await addressToLegalDongCode(row.address);
    if (r?.legalDongCode && /^\d{10}$/.test(r.legalDongCode)) {
      const result: ResolvedAddr = { legalDongCode: r.legalDongCode, lat: r.lat, lng: r.lng };
      geocodeCache.set(row.address, result);
      geocodeOk++;
      return result;
    }
  } catch (e) {
    if (process.env.KAKAO_DEBUG === '1') {
      console.warn(`[geocode] 실패 "${row.address}":`, e);
    }
  }

  geocodeCache.set(row.address, null);
  geocodeFail++;
  return fallback;
}

/* ─── upsert ───────────────────────────────────────────────
 * Phase 2-B schema 변경 후:
 *   @@unique([legalDongCode, programType, complexName])
 * → prisma.lhYouthHousing.upsert 의 where 에 복합 unique 키 사용 가능.
 */

async function upsertOne(row: LhYouthRow, resolved: ResolvedAddr): Promise<'created' | 'updated'> {
  // 빈 단지명 보호 — 복합 unique 충돌 회피
  const safeName = row.complexName?.trim() || '(명칭 없음)';

  const existing = await prisma.lhYouthHousing.findUnique({
    where: {
      lh_complex_uniq: {
        legalDongCode: resolved.legalDongCode,
        programType: row.programType,
        complexName: safeName,
      },
    },
  });

  if (!existing) {
    await prisma.lhYouthHousing.create({
      data: {
        legalDongCode: resolved.legalDongCode,
        programType: row.programType,
        complexName: safeName,
        address: row.address || null,
        lat: resolved.lat,
        lng: resolved.lng,
        unitsAvailable: row.unitsAvailable,
        monthlyRentMin: row.monthlyRentMin,
        monthlyRentMax: row.monthlyRentMax,
      },
    });
    return 'created';
  } else {
    await prisma.lhYouthHousing.update({
      where: { id: existing.id },
      data: {
        address: row.address || existing.address,
        // 좌표는 새로 성공한 경우에만 덮어쓰기 (graceful)
        lat: resolved.lat ?? existing.lat,
        lng: resolved.lng ?? existing.lng,
        unitsAvailable: row.unitsAvailable,
        monthlyRentMin: row.monthlyRentMin,
        monthlyRentMax: row.monthlyRentMax,
      },
    });
    return 'updated';
  }
}

async function upsertRowsWithGeocode(rows: LhYouthRow[]): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 };
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const resolved = await resolveAddress(r);
    const result = await upsertOne(r, resolved);
    if (result === 'created') created++;
    else updated++;

    if ((i + 1) % 25 === 0 || i + 1 === rows.length) {
      process.stdout.write(
        `\r    처리 ${i + 1}/${rows.length} (new ${created} / upd ${updated} · geo ok ${geocodeOk}/fail ${geocodeFail}/cache ${geocodeHits}/skip ${geocodeMiss})`,
      );
    }

    // Kakao rate-limit 마진 — 30만/일 = 약 3.5/초. 캐시 hit 인 경우 sleep 생략.
    if (!OPT_NO_GEOCODE) {
      const wasFreshGeocode = !geocodeCache.has(r.address) || (geocodeOk + geocodeFail === geocodeHits + geocodeOk + geocodeFail);
      if (wasFreshGeocode) await new Promise((res) => setTimeout(res, 50));
    }
  }
  console.log('');
  return { created, updated };
}

/* ─── 메인 ──────────────────────────────────────────────────── */

async function main() {
  const apiKey = process.env.MOLIT_SERVICE_KEY;

  console.log('=== LH 청년주택 단지 마스터 수집 시작 ===');
  console.log(`  시군구: 서울 ${SEOUL_LAWD_CODES.length}개`);
  console.log(`  대상: 행복주택 / 청년매입임대 / 전세임대`);
  console.log(`  옵션: reset=${OPT_RESET} geocode=${!OPT_NO_GEOCODE}`);

  if (!apiKey) {
    console.error('\n[ERROR] MOLIT_SERVICE_KEY 환경변수가 필요합니다.');
    console.error('  server/.env 에 MOLIT_SERVICE_KEY=<공공데이터포털 발급키>');
    process.exit(1);
  }
  if (!OPT_NO_GEOCODE && !process.env.KAKAO_REST_API_KEY) {
    console.warn('\n[WARN] KAKAO_REST_API_KEY 미설정 — 지오코딩 비활성화 (시군구 5자리 유지)');
  }

  if (OPT_RESET) {
    const deleted = await prisma.lhYouthHousing.deleteMany({});
    console.log(`  [reset] 기존 row 삭제: ${deleted.count}건`);
  }

  let totalCollected = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  const failedSigungu: string[] = [];

  for (const { code, name } of SEOUL_LAWD_CODES) {
    process.stdout.write(`  [${name}] 조회 중...`);
    try {
      const rows = await fetchLhYouthHousing(code);
      console.log(` ${rows.length}건`);
      totalCollected += rows.length;

      if (rows.length > 0) {
        const { created, updated } = await upsertRowsWithGeocode(rows);
        totalCreated += created;
        totalUpdated += updated;
      }
    } catch (e) {
      console.warn(` ⚠ 실패 — ${e}`);
      failedSigungu.push(name);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  /* 결과 요약 */
  console.log('\n=== 수집 완료 ===');
  console.log(`  총 수집 (API 응답): ${totalCollected}건`);
  console.log(`  DB 신규: ${totalCreated} / 갱신: ${totalUpdated}`);
  console.log(`  중복 압축률: ${totalCollected > 0 ? Math.round(((totalCollected - totalCreated - totalUpdated) / totalCollected) * 100) : 0}%`);
  console.log(`  지오코딩: ok ${geocodeOk} / fail ${geocodeFail} / cache hit ${geocodeHits} / 주소없음 skip ${geocodeMiss}`);
  if (failedSigungu.length > 0) {
    console.warn(`  실패 시군구: ${failedSigungu.join(', ')}`);
  }

  /* DB 정밀도 확인 */
  const sample = await prisma.lhYouthHousing.groupBy({
    by: ['programType'],
    _count: { id: true },
    _sum: { unitsAvailable: true },
  });

  if (sample.length > 0) {
    console.log('\n  DB 집계 (programType별):');
    sample.forEach((r) =>
      console.log(`    ${r.programType}: ${r._count.id}건 / 총 ${r._sum.unitsAvailable ?? 0}호`),
    );

    const allRows = await prisma.lhYouthHousing.findMany({
      select: { legalDongCode: true, lat: true },
    });
    const dist = { d5: 0, d10: 0, other: 0, withLatLng: 0 };
    allRows.forEach((r) => {
      if (r.legalDongCode.length === 5) dist.d5++;
      else if (r.legalDongCode.length === 10) dist.d10++;
      else dist.other++;
      if (r.lat != null) dist.withLatLng++;
    });
    console.log(`  코드 정밀도: 시군구 5자리=${dist.d5} / 행정동 10자리=${dist.d10} / 기타=${dist.other}`);
    console.log(`  좌표 보유: ${dist.withLatLng}/${allRows.length}건`);

    // 행정동 다양성 — unique BJD 코드 수
    const uniqueDongs = new Set(allRows.map((r) => r.legalDongCode));
    console.log(`  unique 행정동 수: ${uniqueDongs.size}곳`);
  } else {
    console.log('\n  DB 적재 없음 — API 응답 및 인증키를 확인하세요.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
