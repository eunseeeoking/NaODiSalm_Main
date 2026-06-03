/**
 * 수도권 LAWD_CD 코드 생성기 (2026-05-31 신규)
 *
 *  ▷ 목적
 *    client/public/data/capital-centroids.json(행정동 universe, 단일 진실)에서
 *    수도권 시군구 LAWD_CD 목록을 추출해
 *    src/data/capitalAreaLawdCodes.generated.ts 를 생성한다.
 *    → LAWD 목록을 손으로 유지하지 않으므로 행정구역 개편(부천·화성 구 신설 등)
 *      드리프트가 구조적으로 불가능. centroids 만 갱신하면 코드가 따라온다.
 *
 *  ▷ 실행
 *    npm run gen:lawd          # 생성 + 서울 교차검증
 *    (서버 디렉터리에서 실행. centroids 경로는 ../client/public/data 기준)
 *
 *  ▷ 부수효과: 생성 후 서울 25구가 SEOUL_LAWD_CODES(서울 전용 하드코딩)와
 *    코드 집합이 일치하는지 검증하고, 불일치 시 경고 + 종료코드 1.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SEOUL_LAWD_CODES } from '../src/data/seoulLawdCodes';

const CENTROIDS = path.resolve(process.cwd(), '../client/public/data/capital-centroids.json');
const OUT = path.resolve(process.cwd(), 'src/data/capitalAreaLawdCodes.generated.ts');

interface Centroid {
  sigunguCode: string;
  sigungu: string;
  sido: string;
}
interface Entry {
  code: string;
  name: string;
  sido: string;
}

function main() {
  if (!fs.existsSync(CENTROIDS)) {
    console.error(`[gen:lawd] centroids 파일 없음: ${CENTROIDS}`);
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(CENTROIDS, 'utf8')) as Centroid[];

  // 행정동 → 시군구 distinct (코드 기준), 코드 오름차순 정렬
  const byCode = new Map<string, Entry>();
  for (const r of rows) {
    if (!r.sigunguCode || !/^\d{5}$/.test(r.sigunguCode)) continue;
    if (!byCode.has(r.sigunguCode)) {
      byCode.set(r.sigunguCode, { code: r.sigunguCode, name: r.sigungu, sido: r.sido });
    }
  }
  const entries = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  const counts = {
    seoul: entries.filter((e) => e.code.startsWith('11')).length,
    incheon: entries.filter((e) => e.code.startsWith('28')).length,
    gyeonggi: entries.filter((e) => e.code.startsWith('41')).length,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const body = entries
    .map((e) => `  { code: '${e.code}', name: '${e.name}', sido: '${e.sido}' },`)
    .join('\n');

  const out = `/**
 * ⚠️ 자동 생성 파일 — 직접 수정 금지.
 *
 *  생성기: \`npm run gen:lawd\` (scripts/genLawdCodes.ts)
 *  원본(단일 진실): client/public/data/capital-centroids.json
 *
 *  수도권(서울·인천·경기) 시군구 LAWD_CD 목록. 행정동 universe 와 동일한 소스에서
 *  파생되므로 추천·동 집계와 코드가 항상 일치한다(부천·화성 구 개편 등 드리프트 방지).
 *  코드/행정구역이 바뀌면 centroids 를 갱신한 뒤 \`npm run gen:lawd\` 재실행.
 *
 *  생성 시각: ${stamp} · 시군구 ${entries.length}개 (서울 ${counts.seoul} · 인천 ${counts.incheon} · 경기 ${counts.gyeonggi})
 */

export interface LawdEntry {
  /** LAWD_CD 5자리(시군구). 구가 있는 시는 구 단위 코드(예: 수원시영통구 41117). */
  code: string;
  /** 시군구명(centroids 표기 그대로, 구 단위는 "수원시장안구" 형식). */
  name: string;
  /** 시도명. */
  sido: string;
}

export const CAPITAL_AREA_LAWD_CODES: ReadonlyArray<LawdEntry> = [
${body}
];
`;

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`[gen:lawd] 생성 완료 → ${path.relative(process.cwd(), OUT)}`);
  console.log(
    `[gen:lawd] 시군구 ${entries.length}개 (서울 ${counts.seoul} · 인천 ${counts.incheon} · 경기 ${counts.gyeonggi})`,
  );

  // ── 서울 교차검증: SEOUL_LAWD_CODES(서울 전용) 와 코드 집합 일치 확인 ──
  const seoulGen = new Set(entries.filter((e) => e.code.startsWith('11')).map((e) => e.code));
  const seoulHard = new Set(SEOUL_LAWD_CODES.map((s) => s.code));
  const missing = [...seoulHard].filter((c) => !seoulGen.has(c));
  const extra = [...seoulGen].filter((c) => !seoulHard.has(c));
  if (missing.length || extra.length) {
    console.warn('[gen:lawd] ⚠️ 서울 코드 집합 불일치 — SEOUL_LAWD_CODES 확인 필요');
    if (missing.length) console.warn('  하드코딩에만:', missing.join(', '));
    if (extra.length) console.warn('  centroids에만:', extra.join(', '));
    process.exit(1);
  }
  console.log('[gen:lawd] 서울 25구 ↔ SEOUL_LAWD_CODES 코드 집합 일치 ✅');
}

main();
