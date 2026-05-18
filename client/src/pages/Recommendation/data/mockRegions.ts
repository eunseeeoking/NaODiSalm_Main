/**
 * 더미 추천 결과 8건
 *  - 시안 v1 외관 검증용
 *  - 실제 API 연동 전까지 사용
 *  - 강남역 직장 기준 통근시간 (분) 가정
 */
import type { RegionRecommendation } from '../../../types/recommendation';

export const MOCK_REGIONS: RegionRecommendation[] = [
  {
    legalDongCode: '1156013000',
    displayName: '영등포구 당산동',
    sigunguCode: '11560', sigungu: '영등포구', dong: '당산동',
    lat: 37.5326, lng: 126.9039,
    totalScore: 91, commuteScore: 92, valueScore: 89, investmentScore: 85, lifeScore: 80,
    commuteMinutes: 45, representativePrice: 42000, expectedReturn3y: 7.4,
  },
  {
    legalDongCode: '1168010600',
    displayName: '강남구 대치동',
    sigunguCode: '11680', sigungu: '강남구', dong: '대치동',
    lat: 37.5074, lng: 127.0626,
    totalScore: 88, commuteScore: 95, valueScore: 82, investmentScore: 87, lifeScore: 90,
    commuteMinutes: 22, representativePrice: 48000, expectedReturn3y: 8.1,
  },
  {
    legalDongCode: '1165010300',
    displayName: '서초구 방배동',
    sigunguCode: '11650', sigungu: '서초구', dong: '방배동',
    lat: 37.4806, lng: 126.9926,
    totalScore: 84, commuteScore: 88, valueScore: 84, investmentScore: 80, lifeScore: 82,
    commuteMinutes: 28, representativePrice: 38000, expectedReturn3y: 5.2,
  },
  {
    legalDongCode: '1141010100',
    displayName: '서대문구 충정로',
    sigunguCode: '11410', sigungu: '서대문구', dong: '충정로',
    lat: 37.5621, lng: 126.9683,
    totalScore: 82, commuteScore: 80, valueScore: 86, investmentScore: 78, lifeScore: 84,
    commuteMinutes: 35, representativePrice: 35000, expectedReturn3y: 4.8,
  },
  {
    legalDongCode: '1147010200',
    displayName: '양천구 목동',
    sigunguCode: '11470', sigungu: '양천구', dong: '목동',
    lat: 37.5277, lng: 126.8665,
    totalScore: 80, commuteScore: 75, valueScore: 85, investmentScore: 78, lifeScore: 88,
    commuteMinutes: 42, representativePrice: 36000, expectedReturn3y: 5.5,
  },
  {
    legalDongCode: '1144013100',
    displayName: '마포구 망원동',
    sigunguCode: '11440', sigungu: '마포구', dong: '망원동',
    lat: 37.5557, lng: 126.9023,
    totalScore: 78, commuteScore: 80, valueScore: 82, investmentScore: 72, lifeScore: 80,
    commuteMinutes: 38, representativePrice: 39000, expectedReturn3y: 4.5,
  },
  {
    legalDongCode: '1117010300',
    displayName: '용산구 한남동',
    sigunguCode: '11170', sigungu: '용산구', dong: '한남동',
    lat: 37.5347, lng: 127.0098,
    totalScore: 76, commuteScore: 85, valueScore: 70, investmentScore: 82, lifeScore: 78,
    commuteMinutes: 30, representativePrice: 50000, expectedReturn3y: 6.2,
  },
  {
    legalDongCode: '1153010400',
    displayName: '구로구 신도림동',
    sigunguCode: '11530', sigungu: '구로구', dong: '신도림동',
    lat: 37.5085, lng: 126.8918,
    totalScore: 74, commuteScore: 78, valueScore: 88, investmentScore: 65, lifeScore: 75,
    commuteMinutes: 40, representativePrice: 32000, expectedReturn3y: 3.8,
  },
];
