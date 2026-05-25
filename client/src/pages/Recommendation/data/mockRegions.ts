/**
 * 더미 추천 결과 8건 (청년·신혼부부 컨셉, 2026-05-22)
 *  - 시안 외관 검증용 + 실제 API 폴백
 *  - 강남역 직장 기준 통근시간 (분) 가정
 *  - 4축: commuteScore / affordabilityScore / safetyScore / lifeScore
 *
 *  legalDongCode — npm run find:mock-codes 로 검증 완료 (2026-05-24)
 *  모든 코드가 t_legal_dong + t_apt_complex 에 실데이터 존재 확인
 */
import type { RegionRecommendation } from '../../../types/recommendation';

export const MOCK_REGIONS: RegionRecommendation[] = [
  {
    // 1156011700 = 영등포구 당산동 (24개 단지)
    legalDongCode: '1156011700',
    displayName: '영등포구 당산동',
    sigunguCode: '11560', sigungu: '영등포구', dong: '당산동',
    lat: 37.5326, lng: 126.9039,
    totalScore: 91, commuteScore: 92, affordabilityScore: 89, safetyScore: 72, lifeScore: 80,
    commuteMinutes: 45, representativePrice: 42000, expectedReturn3y: 7.4, complexCount: 24,
  },
  {
    // 1168010600 = 강남구 대치동 (81개 단지)
    legalDongCode: '1168010600',
    displayName: '강남구 대치동',
    sigunguCode: '11680', sigungu: '강남구', dong: '대치동',
    lat: 37.5074, lng: 127.0626,
    totalScore: 88, commuteScore: 95, affordabilityScore: 68, safetyScore: 80, lifeScore: 90,
    commuteMinutes: 22, representativePrice: 48000, expectedReturn3y: 8.1, complexCount: 81,
  },
  {
    // 1165010100 = 서초구 방배동 (273개 단지)
    legalDongCode: '1165010100',
    displayName: '서초구 방배동',
    sigunguCode: '11650', sigungu: '서초구', dong: '방배동',
    lat: 37.4806, lng: 126.9926,
    totalScore: 84, commuteScore: 88, affordabilityScore: 75, safetyScore: 78, lifeScore: 82,
    commuteMinutes: 28, representativePrice: 38000, expectedReturn3y: 5.2, complexCount: 273,
  },
  {
    // 1141010200 = 서대문구 충정로3가 (14개 단지)
    legalDongCode: '1141010200',
    displayName: '서대문구 충정로',
    sigunguCode: '11410', sigungu: '서대문구', dong: '충정로3가',
    lat: 37.5621, lng: 126.9683,
    totalScore: 82, commuteScore: 80, affordabilityScore: 86, safetyScore: 65, lifeScore: 84,
    commuteMinutes: 35, representativePrice: 35000, expectedReturn3y: 4.8, complexCount: 14,
  },
  {
    // 1147010200 = 양천구 목동 (141개 단지)
    legalDongCode: '1147010200',
    displayName: '양천구 목동',
    sigunguCode: '11470', sigungu: '양천구', dong: '목동',
    lat: 37.5277, lng: 126.8665,
    totalScore: 80, commuteScore: 75, affordabilityScore: 84, safetyScore: 70, lifeScore: 88,
    commuteMinutes: 42, representativePrice: 36000, expectedReturn3y: 5.5, complexCount: 141,
  },
  {
    // 1144012300 = 마포구 망원동 (82개 단지)
    legalDongCode: '1144012300',
    displayName: '마포구 망원동',
    sigunguCode: '11440', sigungu: '마포구', dong: '망원동',
    lat: 37.5557, lng: 126.9023,
    totalScore: 78, commuteScore: 80, affordabilityScore: 80, safetyScore: 68, lifeScore: 80,
    commuteMinutes: 38, representativePrice: 39000, expectedReturn3y: 4.5, complexCount: 82,
  },
  {
    // 1117013100 = 용산구 한남동 (42개 단지)
    legalDongCode: '1117013100',
    displayName: '용산구 한남동',
    sigunguCode: '11170', sigungu: '용산구', dong: '한남동',
    lat: 37.5347, lng: 127.0098,
    totalScore: 76, commuteScore: 85, affordabilityScore: 62, safetyScore: 75, lifeScore: 78,
    commuteMinutes: 30, representativePrice: 50000, expectedReturn3y: 6.2, complexCount: 42,
  },
  {
    // 1153010100 = 구로구 신도림동 (29개 단지)
    legalDongCode: '1153010100',
    displayName: '구로구 신도림동',
    sigunguCode: '11530', sigungu: '구로구', dong: '신도림동',
    lat: 37.5085, lng: 126.8918,
    totalScore: 74, commuteScore: 78, affordabilityScore: 91, safetyScore: 58, lifeScore: 75,
    commuteMinutes: 40, representativePrice: 32000, expectedReturn3y: 3.8, complexCount: 29,
  },
];
