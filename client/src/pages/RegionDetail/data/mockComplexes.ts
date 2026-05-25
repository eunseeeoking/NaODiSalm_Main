/**
 * 단지 mock 데이터
 *  - MOCK_REGIONS 의 8개 행정동에 대해 각각 3~5개 단지
 *  - 실 API 도착 전까지 사용
 *  - getMockComplexesForRegion(legalDongCode) 로 조회
 */
import type { AptComplex } from '../../../types/region-detail';

/** 행정동코드 → 단지 배열 */
const COMPLEXES_BY_REGION: Record<string, AptComplex[]> = {
  // 강남구 대치동
  '1168010600': [
    {
      complexId: 'C-1168010600-01',
      name: '래미안 대치팰리스',
      legalDongCode: '1168010600',
      lat: 37.5074, lng: 127.0626,
      exclusiveArea: 84.93, sizeBucket: '중형', ageBucket: '신축', builtYear: 2015,
      households: 1278,
      recentPrice: 285000, pricePerM2: 3355,
      predictedPricePerM2_3y: 3870, confidence: 84,
    },
    {
      complexId: 'C-1168010600-02',
      name: '대치 동부센트레빌',
      legalDongCode: '1168010600',
      lat: 37.5082, lng: 127.0612,
      exclusiveArea: 114.96, sizeBucket: '중대형', ageBucket: '준신축', builtYear: 2005,
      households: 805,
      recentPrice: 320000, pricePerM2: 2784,
      predictedPricePerM2_3y: 3170, confidence: 79,
    },
    {
      complexId: 'C-1168010600-03',
      name: '대치미도',
      legalDongCode: '1168010600',
      lat: 37.5061, lng: 127.0641,
      exclusiveArea: 76.50, sizeBucket: '중형', ageBucket: '구축', builtYear: 1983,
      households: 2435,
      recentPrice: 245000, pricePerM2: 3203,
      predictedPricePerM2_3y: 3690, confidence: 76,
    },
    {
      complexId: 'C-1168010600-04',
      name: '대치 SK뷰',
      legalDongCode: '1168010600',
      lat: 37.5067, lng: 127.0589,
      exclusiveArea: 59.92, sizeBucket: '소형', ageBucket: '준신축', builtYear: 2010,
      households: 239,
      recentPrice: 195000, pricePerM2: 3254,
      predictedPricePerM2_3y: 3675, confidence: 81,
    },
  ],
  // 영등포구 당산동
  '1156013000': [
    {
      complexId: 'C-1156013000-01',
      name: '당산 센트럴 아이파크',
      legalDongCode: '1156013000',
      lat: 37.5326, lng: 126.9039,
      exclusiveArea: 84.97, sizeBucket: '중형', ageBucket: '신축', builtYear: 2020,
      households: 802,
      recentPrice: 152000, pricePerM2: 1789,
      predictedPricePerM2_3y: 2050, confidence: 82,
    },
    {
      complexId: 'C-1156013000-02',
      name: '당산 효성해링턴 플레이스',
      legalDongCode: '1156013000',
      lat: 37.5341, lng: 126.9023,
      exclusiveArea: 59.95, sizeBucket: '소형', ageBucket: '준신축', builtYear: 2012,
      households: 1132,
      recentPrice: 118000, pricePerM2: 1969,
      predictedPricePerM2_3y: 2230, confidence: 80,
      isLhComplex: true,
    },
    {
      complexId: 'C-1156013000-03',
      name: '당산 강변래미안',
      legalDongCode: '1156013000',
      lat: 37.5317, lng: 126.9061,
      exclusiveArea: 114.86, sizeBucket: '중대형', ageBucket: '준신축', builtYear: 2003,
      households: 1232,
      recentPrice: 162000, pricePerM2: 1411,
      predictedPricePerM2_3y: 1580, confidence: 75,
    },
  ],
  // 서초구 방배동
  '1165010300': [
    {
      complexId: 'C-1165010300-01',
      name: '방배 서리풀 아크로리버',
      legalDongCode: '1165010300',
      lat: 37.4806, lng: 126.9926,
      exclusiveArea: 84.95, sizeBucket: '중형', ageBucket: '신축', builtYear: 2019,
      households: 757,
      recentPrice: 232000, pricePerM2: 2730,
      predictedPricePerM2_3y: 2980, confidence: 78,
    },
    {
      complexId: 'C-1165010300-02',
      name: '방배 그랑자이',
      legalDongCode: '1165010300',
      lat: 37.4815, lng: 126.9938,
      exclusiveArea: 59.90, sizeBucket: '소형', ageBucket: '신축', builtYear: 2021,
      households: 758,
      recentPrice: 175000, pricePerM2: 2922,
      predictedPricePerM2_3y: 3220, confidence: 80,
    },
    {
      complexId: 'C-1165010300-03',
      name: '방배 래미안 타워',
      legalDongCode: '1165010300',
      lat: 37.4793, lng: 126.9918,
      exclusiveArea: 114.92, sizeBucket: '중대형', ageBucket: '준신축', builtYear: 2009,
      households: 408,
      recentPrice: 245000, pricePerM2: 2132,
      predictedPricePerM2_3y: 2330, confidence: 72,
    },
  ],
  // 서대문구 충정로
  '1141010100': [
    {
      complexId: 'C-1141010100-01',
      name: '충정로 KCC스위첸',
      legalDongCode: '1141010100',
      lat: 37.5621, lng: 126.9683,
      exclusiveArea: 84.91, sizeBucket: '중형', ageBucket: '준신축', builtYear: 2014,
      households: 215,
      recentPrice: 132000, pricePerM2: 1555,
      predictedPricePerM2_3y: 1720, confidence: 70,
    },
    {
      complexId: 'C-1141010100-02',
      name: '충정로역 KR1',
      legalDongCode: '1141010100',
      lat: 37.5608, lng: 126.9669,
      exclusiveArea: 59.88, sizeBucket: '소형', ageBucket: '신축', builtYear: 2018,
      households: 198,
      recentPrice: 108000, pricePerM2: 1804,
      predictedPricePerM2_3y: 2010, confidence: 76,
      isLhComplex: true,
    },
    {
      complexId: 'C-1141010100-03',
      name: '충정로 SK리더스뷰',
      legalDongCode: '1141010100',
      lat: 37.5634, lng: 126.9695,
      exclusiveArea: 114.90, sizeBucket: '중대형', ageBucket: '구축', builtYear: 1998,
      households: 312,
      recentPrice: 142000, pricePerM2: 1236,
      predictedPricePerM2_3y: 1340, confidence: 65,
    },
  ],
  // 양천구 목동
  '1147010200': [
    {
      complexId: 'C-1147010200-01',
      name: '목동 신시가지 7단지',
      legalDongCode: '1147010200',
      lat: 37.5277, lng: 126.8665,
      exclusiveArea: 84.95, sizeBucket: '중형', ageBucket: '구축', builtYear: 1986,
      households: 2550,
      recentPrice: 192000, pricePerM2: 2260,
      predictedPricePerM2_3y: 2570, confidence: 79,
    },
    {
      complexId: 'C-1147010200-02',
      name: '목동 신시가지 5단지',
      legalDongCode: '1147010200',
      lat: 37.5288, lng: 126.8678,
      exclusiveArea: 114.91, sizeBucket: '중대형', ageBucket: '구축', builtYear: 1986,
      households: 1848,
      recentPrice: 245000, pricePerM2: 2132,
      predictedPricePerM2_3y: 2410, confidence: 78,
    },
    {
      complexId: 'C-1147010200-03',
      name: '목동 현대하이페리온',
      legalDongCode: '1147010200',
      lat: 37.5265, lng: 126.8651,
      exclusiveArea: 84.90, sizeBucket: '중형', ageBucket: '준신축', builtYear: 2003,
      households: 466,
      recentPrice: 168000, pricePerM2: 1979,
      predictedPricePerM2_3y: 2200, confidence: 73,
    },
  ],
  // 마포구 망원동
  '1144013100': [
    {
      complexId: 'C-1144013100-01',
      name: '망원 한강 푸르지오',
      legalDongCode: '1144013100',
      lat: 37.5557, lng: 126.9023,
      exclusiveArea: 84.93, sizeBucket: '중형', ageBucket: '신축', builtYear: 2017,
      households: 925,
      recentPrice: 158000, pricePerM2: 1860,
      predictedPricePerM2_3y: 2030, confidence: 77,
    },
    {
      complexId: 'C-1144013100-02',
      name: '망원 강변 아이파크',
      legalDongCode: '1144013100',
      lat: 37.5548, lng: 126.9034,
      exclusiveArea: 59.95, sizeBucket: '소형', ageBucket: '준신축', builtYear: 2011,
      households: 408,
      recentPrice: 112000, pricePerM2: 1868,
      predictedPricePerM2_3y: 2040, confidence: 74,
      isLhComplex: true,
    },
  ],
  // 용산구 한남동
  '1117010300': [
    {
      complexId: 'C-1117010300-01',
      name: '한남 더힐',
      legalDongCode: '1117010300',
      lat: 37.5347, lng: 127.0098,
      exclusiveArea: 84.97, sizeBucket: '중형', ageBucket: '신축', builtYear: 2011,
      households: 600,
      recentPrice: 360000, pricePerM2: 4237,
      predictedPricePerM2_3y: 4730, confidence: 82,
    },
    {
      complexId: 'C-1117010300-02',
      name: '한남 리버사이드',
      legalDongCode: '1117010300',
      lat: 37.5339, lng: 127.0082,
      exclusiveArea: 114.95, sizeBucket: '중대형', ageBucket: '구축', builtYear: 1995,
      households: 312,
      recentPrice: 285000, pricePerM2: 2479,
      predictedPricePerM2_3y: 2720, confidence: 70,
    },
  ],
  // 구로구 신도림동
  '1153010400': [
    {
      complexId: 'C-1153010400-01',
      name: '신도림 디큐브시티',
      legalDongCode: '1153010400',
      lat: 37.5085, lng: 126.8918,
      exclusiveArea: 84.91, sizeBucket: '중형', ageBucket: '준신축', builtYear: 2011,
      households: 1067,
      recentPrice: 142000, pricePerM2: 1673,
      predictedPricePerM2_3y: 1810, confidence: 75,
    },
    {
      complexId: 'C-1153010400-02',
      name: '신도림 e편한세상',
      legalDongCode: '1153010400',
      lat: 37.5092, lng: 126.8929,
      exclusiveArea: 59.92, sizeBucket: '소형', ageBucket: '준신축', builtYear: 2008,
      households: 1758,
      recentPrice: 98000, pricePerM2: 1635,
      predictedPricePerM2_3y: 1750, confidence: 72,
      isLhComplex: true,
    },
    {
      complexId: 'C-1153010400-03',
      name: '신도림 SK뷰',
      legalDongCode: '1153010400',
      lat: 37.5078, lng: 126.8906,
      exclusiveArea: 114.90, sizeBucket: '중대형', ageBucket: '구축', builtYear: 1999,
      households: 1284,
      recentPrice: 132000, pricePerM2: 1149,
      predictedPricePerM2_3y: 1230, confidence: 68,
    },
  ],
};

export function getMockComplexesForRegion(legalDongCode: string): AptComplex[] {
  return COMPLEXES_BY_REGION[legalDongCode] ?? [];
}

/** 전체 단지 평탄화 — 단지 ID 역방향 조회용 */
export function findMockComplex(complexId: string): AptComplex | undefined {
  for (const list of Object.values(COMPLEXES_BY_REGION)) {
    const hit = list.find((c) => c.complexId === complexId);
    if (hit) return hit;
  }
  return undefined;
}
