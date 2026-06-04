/**
 * subwayRouter.ts 단위테스트 (vitest) — 데이터 비의존 엔진 검증.
 *
 *  ▷ 핵심: 합성 그래프로 ride/transfer/도보 스냅이 정확한지 + odsay 분석 §7.1 의
 *          **"삼산동 패턴"**(가깝지만 환승 필요 = 멀지만 직통보다 느림)이 라우터로 분리되는지 검증.
 *          이게 직선거리 폴백이 못 잡는 거짓양성(FP)을 라우터가 잡는다는 증명.
 *
 *  ▷ 좌표 규약: 위도 37.5°N 부근. 0.01 lng ≈ 0.88km, 0.01 lat ≈ 1.11km.
 *  실행: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  SubwayRouter,
  type SubwayGraphData,
  type LatLng,
} from './subwayRouter';
import { validateGraphData } from './subwayGraphLoader';

/** 테스트용 Haversine (assert 비교용) — 라우터 내부와 동일 공식 */
function km(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

describe('SubwayRouter — 기본 ride/transfer', () => {
  // 단일 노선 A-B-C-D (lat 37.5, 동쪽으로 0.03 lng 간격 ≈ 2.6km/구간)
  const line: SubwayGraphData = {
    stations: [
      { id: 'A', name: 'A', line: 'L1', lat: 37.5, lng: 127.0 },
      { id: 'B', name: 'B', line: 'L1', lat: 37.5, lng: 127.03 },
      { id: 'C', name: 'C', line: 'L1', lat: 37.5, lng: 127.06 },
      { id: 'D', name: 'D', line: 'L1', lat: 37.5, lng: 127.09 },
    ],
    rides: [
      { fromId: 'A', toId: 'B', minutes: 3 },
      { fromId: 'B', toId: 'C', minutes: 3 },
      { fromId: 'C', toId: 'D', minutes: 3 },
    ],
  };

  it('직통 노선: A→D = 도보~0 + 승하차4 + 3구간×3분 = 13분, 환승 0', () => {
    const r = new SubwayRouter(line, { walkSpeedKmH: 4, boardingOverheadMin: 4 });
    const res = r.route({ lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.09 });
    expect(res).not.toBeNull();
    expect(res!.transfers).toBe(0);
    // 출발/도착 좌표가 역과 정확히 일치 → 도보 0. 4 + 9 = 13
    expect(res!.minutes).toBe(13);
  });

  it('도보권 역이 없으면 null', () => {
    const r = new SubwayRouter(line, { walkMaxKm: 1.2 });
    // 출발지가 모든 역에서 5km 이상
    const res = r.route({ lat: 37.55, lng: 127.0 }, { lat: 37.5, lng: 127.09 });
    expect(res).toBeNull();
  });

  it('연결 안 된 두 컴포넌트 → null', () => {
    const split: SubwayGraphData = {
      stations: [
        { id: 'A', name: 'A', line: 'L1', lat: 37.5, lng: 127.0 },
        { id: 'B', name: 'B', line: 'L1', lat: 37.5, lng: 127.03 },
        { id: 'P', name: 'P', line: 'L9', lat: 37.7, lng: 127.5 },
        { id: 'Q', name: 'Q', line: 'L9', lat: 37.7, lng: 127.53 },
      ],
      rides: [
        { fromId: 'A', toId: 'B', minutes: 3 },
        { fromId: 'P', toId: 'Q', minutes: 3 },
      ],
    };
    const r = new SubwayRouter(split);
    const res = r.route({ lat: 37.5, lng: 127.0 }, { lat: 37.7, lng: 127.53 });
    expect(res).toBeNull();
  });

  it('환승 1회: 같은 transferKey 노드 사이 transfer 패널티 + 환승수 1', () => {
    const xfer: SubwayGraphData = {
      stations: [
        { id: 'A', name: 'A', line: 'L1', lat: 37.5, lng: 127.0 },
        { id: 'X1', name: 'X', line: 'L1', lat: 37.5, lng: 127.03, transferKey: 'X' },
        { id: 'X2', name: 'X', line: 'L2', lat: 37.5, lng: 127.03, transferKey: 'X' },
        { id: 'Z', name: 'Z', line: 'L2', lat: 37.52, lng: 127.03 },
      ],
      rides: [
        { fromId: 'A', toId: 'X1', minutes: 3 },
        { fromId: 'X2', toId: 'Z', minutes: 3 },
      ],
    };
    const r = new SubwayRouter(xfer, { transferPenaltyMin: 5, boardingOverheadMin: 4 });
    const res = r.route({ lat: 37.5, lng: 127.0 }, { lat: 37.52, lng: 127.03 });
    expect(res).not.toBeNull();
    expect(res!.transfers).toBe(1);
    // 4(승하차) + 3(A→X1) + 5(환승) + 3(X2→Z) = 15
    expect(res!.minutes).toBe(15);
  });
});

describe('SubwayRouter — 삼산동 패턴 (가깝지만 환승 ⇒ 멀지만 직통보다 느림)', () => {
  // 노선1(동서, lat 37.5): X(126.92) - C1(126.95) - C2(126.98) - W(127.00) - P(127.03) - Q(127.06) - S(127.09)
  //   W = 직장 인근 역, S = "소사"(직통, 동쪽 끝).
  // 노선2(북서): T(37.554,127.00) - M(37.53,126.96) - X2(37.50,126.92).  X↔X2 환승.
  //   T = "삼산" 인근 역. 직장(W)엔 직선상 가깝지만, 노선2→X 환승→노선1로 W 까지 멀리 돌아야 함.
  const g: SubwayGraphData = {
    stations: [
      { id: 'X', name: 'X', line: 'L1', lat: 37.5, lng: 126.92, transferKey: 'X' },
      { id: 'C1', name: 'C1', line: 'L1', lat: 37.5, lng: 126.95 },
      { id: 'C2', name: 'C2', line: 'L1', lat: 37.5, lng: 126.98 },
      { id: 'W', name: 'W', line: 'L1', lat: 37.5, lng: 127.0 },
      { id: 'P', name: 'P', line: 'L1', lat: 37.5, lng: 127.03 },
      { id: 'Q', name: 'Q', line: 'L1', lat: 37.5, lng: 127.06 },
      { id: 'S', name: 'S', line: 'L1', lat: 37.5, lng: 127.09 },
      { id: 'T', name: 'T', line: 'L2', lat: 37.554, lng: 127.0 },
      { id: 'M', name: 'M', line: 'L2', lat: 37.53, lng: 126.96 },
      { id: 'X2', name: 'X', line: 'L2', lat: 37.5, lng: 126.92, transferKey: 'X' },
    ],
    rides: [
      { fromId: 'X', toId: 'C1', minutes: 2.5 },
      { fromId: 'C1', toId: 'C2', minutes: 2.5 },
      { fromId: 'C2', toId: 'W', minutes: 2.5 },
      { fromId: 'W', toId: 'P', minutes: 2.5 },
      { fromId: 'P', toId: 'Q', minutes: 2.5 },
      { fromId: 'Q', toId: 'S', minutes: 2.5 },
      { fromId: 'T', toId: 'M', minutes: 2.5 },
      { fromId: 'M', toId: 'X2', minutes: 2.5 },
    ],
  };

  const workplace: LatLng = { lat: 37.5, lng: 127.0 }; // W
  const dongSosa: LatLng = { lat: 37.5005, lng: 127.0895 }; // S 인근 — 직통이지만 직선상 멀다
  const dongSamsan: LatLng = { lat: 37.5535, lng: 127.0005 }; // T 인근 — 직선상 가깝지만 환승 우회

  it('전제: 삼산동이 소사동보다 직장에 직선거리로 더 가깝다', () => {
    const dSamsan = km(dongSamsan, workplace);
    const dSosa = km(dongSosa, workplace);
    expect(dSamsan).toBeLessThan(dSosa); // 삼산 ~5.9km < 소사 ~7.9km
  });

  it('라우터: 삼산동(가깝지만 환승)이 소사동(멀지만 직통)보다 느리다 — 직선폴백이 못 잡는 FP', () => {
    const r = new SubwayRouter(g, {
      transferPenaltyMin: 4,
      defaultRideMinutes: 2.5,
      walkSpeedKmH: 4,
      walkMaxKm: 1.2,
      boardingOverheadMin: 4,
    });
    const samsan = r.route(dongSamsan, workplace);
    const sosa = r.route(dongSosa, workplace);

    expect(samsan).not.toBeNull();
    expect(sosa).not.toBeNull();

    // 소사: 직통 S→Q→P→W (3구간×2.5=7.5) + 승하차4 + 도보~0.6 ≈ 12분, 환승 0
    expect(sosa!.transfers).toBe(0);
    // 삼산: T→M→X2(5) + 환승4 + X→C1→C2→W(7.5) + 승하차4 + 도보~0.9 ≈ 21분, 환승 1
    expect(samsan!.transfers).toBe(1);

    // 핵심 단언: 직선거리는 삼산이 더 가깝지만, 실제 통근은 삼산이 더 느리다.
    expect(samsan!.minutes).toBeGreaterThan(sosa!.minutes);
  });
});

describe('validateGraphData — 그래프 JSON 형식 검증', () => {
  const ok: SubwayGraphData = {
    stations: [
      { id: 'A', name: 'A', line: 'L1', lat: 37.5, lng: 127.0 },
      { id: 'B', name: 'B', line: 'L1', lat: 37.5, lng: 127.03 },
    ],
    rides: [{ fromId: 'A', toId: 'B', minutes: 3 }],
  };

  it('정상 그래프 통과', () => {
    expect(validateGraphData(ok)).not.toBeNull();
  });

  it('stations/rides 누락 시 null', () => {
    expect(validateGraphData({ stations: ok.stations })).toBeNull();
    expect(validateGraphData(null)).toBeNull();
    expect(validateGraphData({ stations: [], rides: [] })).toBeNull();
  });

  it('역 한 행이라도 형식 이상이면 null (조용한 부분 그래프 방지)', () => {
    const bad = { stations: [{ id: 'A', name: 'A', line: 'L1', lat: '37.5', lng: 127.0 }], rides: ok.rides };
    expect(validateGraphData(bad)).toBeNull();
  });
});
