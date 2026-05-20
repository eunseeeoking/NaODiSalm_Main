/**
 * URL ↔ Recommendation 스토어 직렬화
 *
 *  공모전 기획서 차별점:
 *    "URL 공유 → 동일 결과 재현"
 *
 *  쿼리 스키마 (전부 선택, 누락 시 스토어 기본값 유지):
 *    wp   = "lat,lng" 또는 "lat,lng,encodedLabel"     workplace
 *    b    = 정수 (만원)                                budget
 *    w    = "commute-value-investment-life" (합=100)  weights (4개 정수, '-' 구분)
 *    p    = 정수 (분)                                  patience
 *    pre  = "worker"|"investor"|"resident"             preset 키 (있으면 w 보다 우선)
 *
 *  설계 메모:
 *    - 가독성 우선 (base64 금지) — 공유 URL 을 사람이 읽고 의심하지 않게
 *    - label 만 encodeURIComponent (한글 + 쉼표 충돌 방지)
 *    - 부분 파싱 허용 — 일부만 잘못돼도 나머지는 적용 (방어적)
 *    - replaceState 만 사용 → 슬라이더 조작이 뒤로가기 히스토리를 폭주시키지 않음
 */
import {
  WEIGHT_PRESETS,
  type Workplace,
  type Weights,
  type WeightPreset,
} from '../../../types/recommendation';

export interface SharedState {
  workplace: Workplace | null;
  budget: number | null;
  weights: Weights | null;
  patience: number | null;
  preset: WeightPreset | null;
}

const PRESET_KEYS: readonly WeightPreset[] = ['worker', 'investor', 'resident'];

/* ─── 인코딩 ───────────────────────────────────────────────── */

export function encodeStateToParams(input: {
  workplace: Workplace | null;
  budget: number;
  weights: Weights;
  patience: number;
}): URLSearchParams {
  const params = new URLSearchParams();

  if (input.workplace) {
    const { lat, lng, label } = input.workplace;
    // 좌표는 소수점 4자리 (≈11m) — 통근 캐시 키 정밀도와 일치
    const latS = lat.toFixed(4);
    const lngS = lng.toFixed(4);
    const wp = label
      ? `${latS},${lngS},${encodeURIComponent(label)}`
      : `${latS},${lngS}`;
    params.set('wp', wp);
  }

  params.set('b', String(input.budget));
  params.set('p', String(input.patience));

  // weights ↔ preset 매핑 — 정확히 일치하면 pre 만 쓰고 w 는 생략 (URL 짧게)
  const matchedPreset = findMatchingPreset(input.weights);
  if (matchedPreset) {
    params.set('pre', matchedPreset);
  } else {
    const { commute, value, investment, life } = input.weights;
    params.set('w', `${commute}-${value}-${investment}-${life}`);
  }

  return params;
}

/** 스토어 상태를 현재 location.search 와 머지한 URL 문자열로 — replaceState 용 */
export function buildShareUrl(input: {
  workplace: Workplace | null;
  budget: number;
  weights: Weights;
  patience: number;
}): string {
  const params = encodeStateToParams(input);
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

/* ─── 디코딩 ───────────────────────────────────────────────── */

export function decodeParamsToState(params: URLSearchParams): SharedState {
  return {
    workplace: parseWorkplace(params.get('wp')),
    budget: parsePositiveInt(params.get('b')),
    weights: parseWeights(params.get('w')),
    patience: parsePositiveInt(params.get('p')),
    preset: parsePreset(params.get('pre')),
  };
}

function parseWorkplace(raw: string | null): Workplace | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 한국 영역 대략 검증 — 외부에서 장난친 좌표 차단
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  const label = parts[2] ? safeDecode(parts.slice(2).join(',')) : '';
  return { lat, lng, label: label || `${lat.toFixed(3)}, ${lng.toFixed(3)}` };
}

function parseWeights(raw: string | null): Weights | null {
  if (!raw) return null;
  const parts = raw.split('-').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [commute, value, investment, life] = parts;
  const sum = commute + value + investment + life;
  // 합계 95~105 허용 (반올림 오차 + 약간의 융통성)
  if (sum < 95 || sum > 105) return null;
  return { commute, value, investment, life };
}

function parsePreset(raw: string | null): WeightPreset | null {
  if (!raw) return null;
  return PRESET_KEYS.includes(raw as WeightPreset) ? (raw as WeightPreset) : null;
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

/* ─── 헬퍼 ─────────────────────────────────────────────────── */

function findMatchingPreset(w: Weights): WeightPreset | null {
  for (const key of PRESET_KEYS) {
    const p = WEIGHT_PRESETS[key];
    if (
      p.commute === w.commute &&
      p.value === w.value &&
      p.investment === w.investment &&
      p.life === w.life
    ) {
      return key;
    }
  }
  return null;
}

/** 외부에서 받은 preset 또는 weights 중 적용할 최종 weights 결정 */
export function resolveWeights(state: SharedState): Weights | null {
  if (state.preset) return { ...WEIGHT_PRESETS[state.preset] };
  return state.weights;
}
