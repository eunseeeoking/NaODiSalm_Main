/**
 * 발표 데모용 인기 직장 6곳
 *  - 사전 캐싱 대상 — ODsay 통근 매트릭스가 미리 계산되어 즉시 응답
 *  - 칩 형태로 검색창 하단에 노출
 */
import type { Workplace } from '../../../types/recommendation';

export interface PopularWorkplace extends Workplace {
  id: string;
}

export const POPULAR_WORKPLACES: PopularWorkplace[] = [
  { id: 'gangnam',  label: '강남역',   lat: 37.4979, lng: 127.0276, addressName: '서울 강남구 강남대로' },
  { id: 'gwanghwa', label: '광화문',   lat: 37.5717, lng: 126.9764, addressName: '서울 종로구 세종대로' },
  { id: 'yeouido',  label: '여의도',   lat: 37.5219, lng: 126.9245, addressName: '서울 영등포구 여의대로' },
  { id: 'pangyo',   label: '판교',     lat: 37.3947, lng: 127.1112, addressName: '경기 성남시 분당구' },
  { id: 'jamsil',   label: '잠실',     lat: 37.5133, lng: 127.1000, addressName: '서울 송파구 올림픽로' },
  { id: 'magok',    label: '마곡',     lat: 37.5598, lng: 126.8278, addressName: '서울 강서구 마곡중앙로' },
];
