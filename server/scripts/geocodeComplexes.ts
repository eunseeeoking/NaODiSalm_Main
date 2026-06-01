/**
 * 비아파트 단지 좌표 백필 CLI (2026-05-31 신규)
 *
 *  ▷ 배경
 *    오피스텔/연립다세대(빌라)/단독·다가구 실거래 API 응답에는 좌표가 없다.
 *    realtyIngest 의 upsertComplexes 는 name/jibun/roadAddr 만 저장하고 lat/lng 는 NULL.
 *    이 스크립트가 NULL 단지를 Kakao geocoder 로 좌표화해 t_*_complex.lat/lng 를 채운다.
 *
 *  ▷ 주소 조립
 *    1순위 도로명(roadAddr) → 2순위 지번주소(`{sido} {시군구} {법정동} {jibun}`)
 *    → 3순위 키워드(`{시군구} {법정동} {단지명}`). geocodeFlexible 가 순서대로 시도.
 *    ※ 시군구명은 centroids 표기('수원시영통구')라 Kakao 호환 위해 '수원시 영통구'로 띄어쓰기 보정.
 *
 *  ▷ 실행
 *    # 현황만 (호출 0) — NULL 좌표 단지 수 점검
 *    npm run geocode:complexes -- --type=OFFI --dry
 *
 *    # 샘플 200건만 좌표화(점검용)
 *    npm run geocode:complexes -- --type=OFFI --limit=200
 *
 *    # 전체 백필 (OFFI)
 *    npm run geocode:complexes -- --type=OFFI
 *
 *    # 여러 유형
 *    npm run geocode:complexes -- --type=OFFI,VILLA
 *
 *    # ⭐ 법정동 centroid 폴백 — API 무매칭으로 NULL 남은 단지를 같은 법정동의
 *    #    좌표 보유 단지 평균으로 채움(빌라 무매칭 복구). API 키 불필요.
 *    npm run geocode:complexes -- --type=VILLA --fallback-dong
 *
 *  ▷ 환경변수: KAKAO_REST_API_KEY (필수, 일 30만 호출). KAKAO_DEBUG=1 로 미스 로깅.
 *  ▷ 재개: lat IS NULL 행만 조회하므로 중단 후 재실행하면 남은 분만 처리(체크포인트 불필요).
 *  ▷ bbox 가드: 수도권(lat 36.8~38.3 / lng 126.0~127.9) 밖 매칭은 타지역 동명 오매칭으로
 *    보고 저장 거부(무매칭 처리). 완료 시 bbox 밖 좌표 수를 자동 카운트.
 */

import 'dotenv/config';
import { prisma } from '../src/services/db';
import { geocodeFlexible } from '../src/services/external/geocoder';
import { CAPITAL_AREA_LAWD_CODES } from '../src/data/seoulLawdCodes';

/* ─── CLI ──────────────────────────────────────────────────── */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const VALID = ['OFFI', 'VILLA', 'SH'] as const;
type CplxType = (typeof VALID)[number];

const types = (arg('type') ?? 'OFFI')
  .toUpperCase()
  .split(',')
  .map((t) => t.trim())
  .filter((t): t is CplxType => (VALID as readonly string[]).includes(t));

const DRY = has('dry');
const LIMIT = arg('limit') ? Math.max(1, parseInt(arg('limit')!, 10)) : undefined;
const SLEEP_MS = Number(arg('sleep') ?? 200);
// --fallback-dong : API 지오코딩 대신, 남은 NULL 단지를 같은 (시군구·법정동)의
//   이미 좌표화된 단지 평균(법정동 centroid)으로 채움. 빌라 무매칭(동명/건물명 비일관) 복구용.
const FALLBACK_DONG = has('fallback-dong');

// 수도권 대략 경계 — 이 밖이면 키워드가 타지역 동명에 잘못 매칭된 것으로 간주(저장 거부).
const BBOX = { latMin: 36.8, latMax: 38.3, lngMin: 126.0, lngMax: 127.9 };
const inCapital = (lat: number, lng: number) =>
  lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;

/* ─── 유형별 Prisma 델리게이트 ─────────────────────────────── */

const DELEGATE: Record<CplxType, any> = {
  OFFI: prisma.offiComplex,
  VILLA: prisma.villaComplex,
  SH: prisma.shComplex,
};

/* ─── 시군구 코드 → {sido, 시군구(띄어쓰기 보정)} ──────────── */

/** ' 수원시영통구' → '수원시 영통구' (시+구 사이 공백). 단일 시군구·서울 구는 그대로. */
function spaceGu(name: string): string {
  const m = name.match(/^(.+시)(.+[구군])$/);
  return m ? `${m[1]} ${m[2]}` : name;
}
const SIGUNGU = new Map(
  CAPITAL_AREA_LAWD_CODES.map((e) => [e.code, { sido: e.sido, name: spaceGu(e.name) }]),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * geocodeFlexible 재시도 래퍼.
 *  - 네트워크 오류(fetch failed / timeout)는 일시적이므로 백오프 후 재시도.
 *  - 정상 응답이지만 결과 없음(null)은 즉시 반환(재시도 무의미).
 *  - 모든 시도가 네트워크 오류면 throw → 호출부가 해당 행을 건너뛰고 다음 실행 때 재시도.
 */
async function geocodeWithRetry(
  opts: { roadAddr?: string | null; jibunAddr?: string | null; keyword?: string | null },
  attempts = 4,
): Promise<{ lat: number; lng: number } | null> {
  let lastErr: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await geocodeFlexible(opts);
    } catch (e) {
      lastErr = e;
      await sleep(800 * a); // 0.8s → 1.6s → 2.4s 백오프
    }
  }
  throw lastErr;
}

/* ─── 유형별 백필 ──────────────────────────────────────────── */

async function backfill(type: CplxType) {
  const model = DELEGATE[type];
  const total = await model.count();
  const missing = await model.count({ where: { lat: null } });
  console.log(
    `\n[${type}] 전체 ${total.toLocaleString()} · 좌표없음 ${missing.toLocaleString()} ` +
      `(커버리지 ${total ? (((total - missing) / total) * 100).toFixed(1) : '0'}%)`,
  );
  if (DRY || missing === 0) return;

  const rows: Array<{
    id: number;
    name: string;
    sigunguCode: string;
    legalDong: string;
    jibun: string | null;
    roadAddr: string | null;
  }> = await model.findMany({
    where: { lat: null },
    select: { id: true, name: true, sigunguCode: true, legalDong: true, jibun: true, roadAddr: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  // 같은 주소 반복 호출 방지용 캐시
  const cache = new Map<string, { lat: number; lng: number } | null>();
  let ok = 0;
  let miss = 0;
  let netFail = 0; // 재시도 후에도 네트워크 실패한 행(다음 실행 때 재시도됨)

  const fmtMin = (ms: number) => (ms / 60000).toFixed(1);
  const estMs = rows.length * SLEEP_MS; // 캐시 0% 가정 최대치
  console.log(
    `  [${type}] 처리 대상 ${rows.length.toLocaleString()}건 · sleep ${SLEEP_MS}ms ` +
      `→ 예상 최대 ~${fmtMin(estMs)}분(캐시히트만큼 단축)`,
  );
  const loopStart = Date.now();
  const LOG_EVERY = 100;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sg = SIGUNGU.get(r.sigunguCode);
    const region = sg ? `${sg.sido} ${sg.name}` : '';
    const jibunAddr = r.jibun ? `${region} ${r.legalDong} ${r.jibun}`.trim() : null;
    const keyword = `${sg?.name ?? ''} ${r.legalDong} ${r.name}`.trim();

    const cacheKey = r.roadAddr ?? jibunAddr ?? keyword;
    let hit = cache.get(cacheKey);
    if (hit === undefined) {
      try {
        hit = await geocodeWithRetry({ roadAddr: r.roadAddr, jibunAddr, keyword });
        cache.set(cacheKey, hit);
      } catch (e) {
        // 재시도 후에도 네트워크 실패 → 이 행은 NULL 유지, 잡은 계속(재실행 시 자동 재시도)
        netFail++;
        if (netFail % 20 === 1) {
          process.stdout.write(
            `\n  ⚠ 네트워크 오류 누적 ${netFail}건 — 해당 행 건너뜀(다음 실행 시 재시도): ${(e as Error).message}\n`,
          );
        }
        await sleep(SLEEP_MS * 4); // 네트워크 흔들릴 때 잠깐 더 쉼
        continue;
      }
      await sleep(SLEEP_MS);
    }

    if (hit && !inCapital(hit.lat, hit.lng)) {
      // 키워드가 타지역 동명에 잘못 매칭 → 저장 거부(무매칭 처리, NULL 유지)
      miss++;
      if (process.env.KAKAO_DEBUG === '1') console.log(`  bbox밖 거부: ${keyword} (${hit.lat},${hit.lng})`);
    } else if (hit) {
      await model.update({ where: { id: r.id }, data: { lat: hit.lat, lng: hit.lng } });
      ok++;
    } else {
      miss++;
      if (process.env.KAKAO_DEBUG === '1') console.log(`  miss: ${keyword} / ${jibunAddr ?? ''}`);
    }

    if ((i + 1) % LOG_EVERY === 0 || i + 1 === rows.length) {
      const done = i + 1;
      const elapsed = Date.now() - loopStart;
      const rate = done / (elapsed / 1000); // 건/초
      const etaMs = ((rows.length - done) / Math.max(rate, 0.01)) * 1000;
      const pct = ((done / rows.length) * 100).toFixed(1);
      // \r 로 한 줄 갱신 (마지막엔 줄바꿈)
      process.stdout.write(
        `\r  [${type}] ${done.toLocaleString()}/${rows.length.toLocaleString()} (${pct}%) ` +
          `· 성공 ${ok} 실패 ${miss} · ${rate.toFixed(1)}건/s ` +
          `· 경과 ${fmtMin(elapsed)}분 · ETA ${fmtMin(etaMs)}분   ` +
          (i + 1 === rows.length ? '\n' : ''),
      );
    }
  }

  const remain = await model.count({ where: { lat: null } });
  console.log(
    `[${type}] 완료 — 좌표화 ${ok} · 실패(무매칭) ${miss} · 네트워크건너뜀 ${netFail} · 캐시히트 ${rows.length - cache.size} · ` +
      `남은 NULL ${remain.toLocaleString()}` +
      (miss > 0 ? `  ⚠️ 무매칭율 ${((miss / rows.length) * 100).toFixed(1)}% (동명/건물명 비일관 점검)` : ''),
  );
  if (netFail > 0) {
    console.log(`[${type}] ℹ️ 네트워크로 건너뛴 ${netFail}건은 NULL로 남아 — 같은 명령 재실행하면 자동으로 이어서 처리됩니다.`);
  }

  // ── 무료 정합성 검사: 수도권 bbox 밖 좌표 = 엉뚱한 도시로 오매칭 의심 ──
  // 수도권 대략 경계: lat 36.8~38.3, lng 126.0~127.9
  const outOfBox = await model.count({
    where: {
      OR: [
        { lat: { lt: 36.8 } }, { lat: { gt: 38.3 } },
        { lng: { lt: 126.0 } }, { lng: { gt: 127.9 } },
      ],
    },
  });
  if (outOfBox > 0) {
    console.log(
      `[${type}] ⚠️ 수도권 bbox 밖 좌표 ${outOfBox.toLocaleString()}건 — 오매칭 의심(키워드가 동명 타지역 매칭). 점검 권장.`,
    );
  } else {
    console.log(`[${type}] ✅ 좌표 전부 수도권 bbox 내 — 오매칭 없음.`);
  }
}

/* ─── 법정동 centroid 폴백 ─────────────────────────────────────
 * API 무매칭으로 NULL 남은 단지를, 같은 (시군구·법정동)에서 이미 좌표화된 단지들의
 * 평균 좌표(=법정동 centroid)로 채운다. 빌라처럼 건물명·지번 해상이 어려운 경우 복구용.
 *  - 정밀 좌표가 아니라 동 단위 근사치(같은 법정동 단지는 동일 좌표) → 지도 핀보다는
 *    추천 universe·동 집계·"동 평가"(depth3) 용도. API 호출 없음.
 */
async function fillDongCentroid(type: CplxType) {
  const model = DELEGATE[type];

  // 0) bbox 밖(오매칭) 좌표는 NULL 로 되돌려 centroid 로 재충전
  const cleaned = await model.updateMany({
    where: { OR: [{ lat: { lt: 36.8 } }, { lat: { gt: 38.3 } }, { lng: { lt: 126.0 } }, { lng: { gt: 127.9 } }] },
    data: { lat: null, lng: null },
  });
  if (cleaned.count) console.log(`[${type}] bbox 밖 ${cleaned.count}건 → NULL 정리(centroid 재충전 대상)`);

  const before = await model.count({ where: { lat: null } });
  if (before === 0) {
    console.log(`[${type}] NULL 단지 없음 — 폴백 불필요.`);
    return;
  }

  // 1) 법정동별 centroid (좌표 보유 단지 평균)
  const groups = await model.groupBy({
    by: ['sigunguCode', 'legalDong'],
    where: { lat: { not: null } },
    _avg: { lat: true, lng: true },
  });

  // 2) 법정동 단위로 NULL 단지를 centroid 로 일괄 채움
  let filled = 0;
  for (const g of groups) {
    if (g._avg.lat == null || g._avg.lng == null) continue;
    const res = await model.updateMany({
      where: { sigunguCode: g.sigunguCode, legalDong: g.legalDong, lat: null },
      data: { lat: g._avg.lat, lng: g._avg.lng },
    });
    filled += res.count;
  }

  const after = await model.count({ where: { lat: null } });
  console.log(
    `[${type}] 법정동 centroid 폴백 — 채움 ${filled.toLocaleString()} · 남은 NULL ${after.toLocaleString()} ` +
      `(남은 건 해당 법정동에 정밀 좌표 단지가 0개) · 커버리지 ${(((await model.count()) - after) / (await model.count()) * 100).toFixed(1)}%`,
  );
  console.log(`[${type}] ⚠️ 폴백 좌표는 동 단위 근사치 — 지도 핀이 아닌 추천 universe·동 집계용.`);
}

async function main() {
  if (types.length === 0) {
    console.error(`[ERROR] --type 은 ${VALID.join('|')} 중 하나 (콤마 다중)`);
    process.exit(1);
  }

  // 폴백 모드: API 호출 없이 NULL 을 법정동 centroid 로 채움
  if (FALLBACK_DONG) {
    console.log(`[geocode] 법정동 centroid 폴백 모드 — 유형: ${types.join(', ')} (API 호출 없음)`);
    for (const t of types) await fillDongCentroid(t);
    await prisma.$disconnect();
    return;
  }

  if (!process.env.KAKAO_REST_API_KEY && !DRY) {
    console.error('[ERROR] KAKAO_REST_API_KEY 미설정 (현황만 보려면 --dry)');
    process.exit(1);
  }
  console.log(`[geocode] 유형: ${types.join(', ')}${DRY ? ' · DRY(현황만)' : ''}${LIMIT ? ` · limit ${LIMIT}` : ''}`);
  for (const t of types) await backfill(t);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[geocode] 치명적 오류:', e);
  await prisma.$disconnect();
  process.exit(1);
});
