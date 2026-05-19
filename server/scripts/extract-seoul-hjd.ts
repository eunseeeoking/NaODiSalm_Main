/**
 * 서울 행정동 전처리 스크립트
 *
 *  · 입력  : client/public/data/seoul-hjd.geojson (vuski/admdongkor, 전국 ~3,500개)
 *  · 출력 1: client/public/data/seoul-hjd-simplified.geojson (서울 25개구 ~470개)
 *  · 출력 2: client/public/data/seoul-centroids.json (행정동별 중심 좌표)
 *
 *  실행: cd server && npx tsx scripts/extract-seoul-hjd.ts
 *
 *  vuski/admdongkor properties 표준:
 *    adm_nm   "서울특별시 강남구 역삼1동"
 *    adm_cd   행정동 코드 (8 또는 10자리)
 *    adm_cd2  10자리 표준 코드
 *    sgg      시군구 코드 (5자리)
 *    sido     시도 코드 (2자리, 서울="11")
 */
import * as fs from 'fs';
import * as path from 'path';

interface Feature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: Record<string, string | number | undefined>;
}

interface Centroid {
  /** 행정동 코드 (10자리 표준) */
  code: string;
  /** 행정동명 (예: "역삼1동") */
  name: string;
  /** 시군구명 (예: "강남구") */
  sigungu: string;
  /** 시군구 코드 (5자리, 예: "11680") */
  sigunguCode: string;
  /** WGS84 중심 좌표 */
  lat: number;
  lng: number;
}

const CLIENT_DATA = path.resolve(__dirname, '../../client/public/data');
const INPUT = path.join(CLIENT_DATA, 'seoul-hjd.geojson');
const OUTPUT_GEO = path.join(CLIENT_DATA, 'seoul-hjd-simplified.geojson');
const OUTPUT_CENTROIDS = path.join(CLIENT_DATA, 'seoul-centroids.json');

// ─────────────────────────────────────────────────────────
// 다각형 면적 가중 중심 계산 (Shoelace 공식)
// 단순 점 평균은 좁고 긴 폴리곤에서 중심이 폴리곤 밖에 떨어질 수 있음 → 면적 가중 필수
// ─────────────────────────────────────────────────────────
function polygonCentroid(coords: number[][]): {
  lat: number;
  lng: number;
  area: number;
} {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-10) {
    // 면적 0 fallback — 점 평균
    let sx = 0;
    let sy = 0;
    for (const [x, y] of coords) {
      sx += x;
      sy += y;
    }
    return { lng: sx / coords.length, lat: sy / coords.length, area: 0 };
  }
  return { lng: cx / (6 * a), lat: cy / (6 * a), area: Math.abs(a) };
}

function featureCentroid(feature: Feature): { lat: number; lng: number } {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') {
    const ring = (coordinates as number[][][])[0];
    const c = polygonCentroid(ring);
    return { lat: c.lat, lng: c.lng };
  }
  // MultiPolygon — 가장 큰 polygon 의 centroid 사용
  const polys = coordinates as number[][][][];
  let best = { lat: 0, lng: 0, area: -1 };
  for (const poly of polys) {
    const c = polygonCentroid(poly[0]);
    if (c.area > best.area) best = c;
  }
  return { lat: best.lat, lng: best.lng };
}

// ─────────────────────────────────────────────────────────
// properties 정규화 — vuski 데이터 키 변형 대응
// ─────────────────────────────────────────────────────────
function extractCode(props: Feature['properties']): string {
  return String(props.adm_cd2 ?? props.adm_cd ?? '');
}

function extractName(props: Feature['properties']): {
  full: string;
  sigungu: string;
  dong: string;
} {
  const full = String(props.adm_nm ?? '');
  const parts = full.split(' ');
  // 예: ["서울특별시", "강남구", "역삼1동"]
  return {
    full,
    sigungu: parts[1] ?? '',
    dong: parts[parts.length - 1] ?? '',
  };
}

// ─────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 Reading GeoJSON...');
  const raw = fs.readFileSync(INPUT, 'utf-8');
  const data = JSON.parse(raw) as {
    type: 'FeatureCollection';
    features: Feature[];
  };
  console.log(`   전체 feature: ${data.features.length}`);

  // 첫 feature 속성 디버그 — properties 키 변형 시 즉시 발견
  if (data.features.length > 0) {
    console.log('   sample properties keys:', Object.keys(data.features[0].properties));
    console.log('   sample properties     :', data.features[0].properties);
  }

  // 서울만 필터 (행정동 코드가 "11" 로 시작)
  const seoulFeatures = data.features.filter((f) => {
    const code = extractCode(f.properties);
    return code.startsWith('11');
  });
  console.log(`✅ 서울 feature: ${seoulFeatures.length}`);

  // centroids 추출
  const centroids: Centroid[] = seoulFeatures.map((f) => {
    const code = extractCode(f.properties);
    const { sigungu, dong } = extractName(f.properties);
    const sigunguCode = code.substring(0, 5);
    const { lat, lng } = featureCentroid(f);
    return { code, name: dong, sigungu, sigunguCode, lat, lng };
  });

  // 시군구 분포 통계 — 25개 구가 골고루 잡혔는지 검증
  const sigunguStats: Record<string, number> = {};
  for (const c of centroids) {
    sigunguStats[c.sigungu] = (sigunguStats[c.sigungu] ?? 0) + 1;
  }
  console.log('\n📊 시군구별 행정동 수:');
  Object.entries(sigunguStats)
    .sort(([, a], [, b]) => b - a)
    .forEach(([sgg, n]) => console.log(`   ${sgg.padEnd(8)} ${n}`));

  // 출력 — 폴리곤은 그대로 (서울만 필터링)
  const simplifiedGeo = {
    type: 'FeatureCollection',
    features: seoulFeatures,
  };

  fs.writeFileSync(OUTPUT_GEO, JSON.stringify(simplifiedGeo));
  fs.writeFileSync(OUTPUT_CENTROIDS, JSON.stringify(centroids, null, 2));

  const geoSize = (fs.statSync(OUTPUT_GEO).size / 1024).toFixed(0);
  const centSize = (fs.statSync(OUTPUT_CENTROIDS).size / 1024).toFixed(0);
  console.log('\n✅ 저장 완료');
  console.log(`   ${path.relative(process.cwd(), OUTPUT_GEO)}: ${geoSize}KB`);
  console.log(`   ${path.relative(process.cwd(), OUTPUT_CENTROIDS)}: ${centSize}KB`);
}

main().catch((e) => {
  console.error('❌ 실패:', e);
  process.exit(1);
});
