/**
 * 수도권 행정동 전처리 스크립트 (서울 + 경기 + 인천)
 *
 *  · 입력  : client/public/data/seoul-hjd.geojson (vuski/admdongkor 전국 ~3,500개)
 *  · 출력 1: client/public/data/capital-hjd-simplified.geojson (수도권 ~1,200개)
 *  · 출력 2: client/public/data/capital-centroids.json (행정동별 중심 좌표)
 *
 *  실행: cd server && node --experimental-strip-types scripts/extract-capital-hjd.ts
 *
 *  ▷ 수도권 sido prefix (행안부 10자리 표준 기준)
 *    11 = 서울, 28 = 인천, 41 = 경기
 *    실행 시 sido 분포를 먼저 출력 → 예상과 다르면 SIDO_PREFIXES 조정
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Feature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: Record<string, string | number | undefined>;
}

interface Centroid {
  code: string;
  name: string;
  sigungu: string;
  sigunguCode: string;
  sido: string;
  lat: number;
  lng: number;
}

const CLIENT_DATA = path.resolve(__dirname, '../../client/public/data');
const INPUT = path.join(CLIENT_DATA, 'seoul-hjd.geojson');
const OUTPUT_GEO = path.join(CLIENT_DATA, 'capital-hjd-simplified.geojson');
const OUTPUT_CENTROIDS = path.join(CLIENT_DATA, 'capital-centroids.json');

const SIDO_PREFIXES = ['11', '28', '41'];

function polygonCentroid(coords: number[][]): { lat: number; lng: number; area: number } {
  let cx = 0, cy = 0, a = 0;
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
    let sx = 0, sy = 0;
    for (const [x, y] of coords) { sx += x; sy += y; }
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
  const polys = coordinates as number[][][][];
  let best = { lat: 0, lng: 0, area: -1 };
  for (const poly of polys) {
    const c = polygonCentroid(poly[0]);
    if (c.area > best.area) best = c;
  }
  return { lat: best.lat, lng: best.lng };
}

function extractCode(props: Feature['properties']): string {
  return String(props.adm_cd2 ?? props.adm_cd ?? '');
}

function extractName(props: Feature['properties']): { full: string; sido: string; sigungu: string; dong: string } {
  const full = String(props.adm_nm ?? '');
  const parts = full.split(' ');
  const sido = parts[0] ?? '';
  let sigungu = parts[1] ?? '';
  const dong = parts[parts.length - 1] ?? '';
  if (parts.length >= 4 && parts[2].endsWith('구')) {
    sigungu = parts[1] + ' ' + parts[2];
  }
  return { full, sido, sigungu, dong };
}

async function main() {
  console.log('Reading GeoJSON...');
  const raw = fs.readFileSync(INPUT, 'utf-8');
  const data = JSON.parse(raw) as { type: 'FeatureCollection'; features: Feature[] };
  console.log('  total features: ' + data.features.length);

  const sidoStats: Record<string, number> = {};
  for (const f of data.features) {
    const code = extractCode(f.properties);
    const prefix = code.substring(0, 2);
    sidoStats[prefix] = (sidoStats[prefix] ?? 0) + 1;
  }
  console.log('\nFull sido prefix distribution (top 10):');
  Object.entries(sidoStats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([p, n]) => console.log('  ' + p + '  ' + n));

  const capitalFeatures = data.features.filter((f) => {
    const code = extractCode(f.properties);
    return SIDO_PREFIXES.some((p) => code.startsWith(p));
  });
  console.log('\nCapital features: ' + capitalFeatures.length);

  if (capitalFeatures.length === 0) {
    console.error('Zero capital features. Check SIDO_PREFIXES');
    process.exit(2);
  }

  const centroids: Centroid[] = capitalFeatures.map((f) => {
    const code = extractCode(f.properties);
    const { sido, sigungu, dong } = extractName(f.properties);
    const sigunguCode = code.substring(0, 5);
    const { lat, lng } = featureCentroid(f);
    return { code, name: dong, sigungu, sigunguCode, sido, lat, lng };
  });

  const sidoBreak: Record<string, number> = {};
  for (const c of centroids) {
    sidoBreak[c.sido] = (sidoBreak[c.sido] ?? 0) + 1;
  }
  console.log('\nDongs by sido:');
  Object.entries(sidoBreak)
    .sort(([, a], [, b]) => b - a)
    .forEach(([s, n]) => console.log('  ' + s.padEnd(8) + ' ' + n));

  const simplifiedGeo = { type: 'FeatureCollection', features: capitalFeatures };
  fs.writeFileSync(OUTPUT_GEO, JSON.stringify(simplifiedGeo));
  fs.writeFileSync(OUTPUT_CENTROIDS, JSON.stringify(centroids, null, 2));

  const geoSize = (fs.statSync(OUTPUT_GEO).size / 1024).toFixed(0);
  const centSize = (fs.statSync(OUTPUT_CENTROIDS).size / 1024).toFixed(0);
  console.log('\nSaved.');
  console.log('  ' + path.relative(process.cwd(), OUTPUT_GEO) + ': ' + geoSize + 'KB');
  console.log('  ' + path.relative(process.cwd(), OUTPUT_CENTROIDS) + ': ' + centSize + 'KB');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
