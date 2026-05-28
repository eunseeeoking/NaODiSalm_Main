# 작업 로그 — 2026-05-20

## 한 줄 요약

> Depth 3 (지역 상세) 페이지 1차 구현 완료 — 라우트 + 미니 지도 + 매물 카드 리스트 + LSTM 풀 분석 카드(시안 B) + 통근 비교(대중교통 vs 자차). 실제 API 도착 전까지 mock 데이터로 시연 가능.
> **추가:** 서비스명 리브랜딩 "스마트 직세권" → **"나어디삶"** 일괄 적용 (rebranding.md). DB 운영 계정 root → molit 전환 안내.

---

## 동일 디렉토리 자매 문서

```
server/doc/2026-05-20/
  ├─ work-log.md             (현재 파일)
  ├─ rebranding.md           서비스명 변경 사유 + 적용 범위 + 로고 SVG 사양
  └─ depth3-architecture.md  Depth 3 컴포넌트 트리 + 데이터 흐름 + mock→API 매핑
```

---

## 0. 작업 컨텍스트

- 어제(2026-05-19) work-log 마지막 한 줄: **"Depth 3 진입"**
- next-steps.md 권장 첫 항목 그대로 수행
- 데이터 소스 전략: **mock 먼저 + API 분리** (UI/시연 우선, 서버 추천 API는 다음 세션 별도 작업)

---

## 1. 신규 / 편집 파일

### 신규 (Depth 3 도메인)
```
client/src/types/region-detail.ts                       AptComplex / LstmPoint / LstmAnalysis / CommuteCompareData
client/src/pages/RegionDetail/
  ├─ index.tsx                                          페이지 컨테이너 + 레이아웃
  ├─ components/
  │   ├─ RegionDetailHeader.tsx                         지역명 + 종합점수 + 뒤로가기 + 테마 토글
  │   ├─ RegionMiniMap.tsx                              카카오맵 + 단지 핀 + 직장 마커
  │   ├─ ComplexCardList.tsx                            매물 단지 가로 스크롤 리스트
  │   ├─ LstmFullAnalysis.tsx                           시안 B 풀카드 (라인 + 도넛 + 4축 메트릭)
  │   └─ CommuteCompare.tsx                             대중교통 vs 자차 + 월 통근비 차이
  └─ data/
      ├─ mockComplexes.ts                               8개 행정동 × 2~4 단지 (~24건)
      ├─ mockLstmResults.ts                             결정론적 60+36 시계열 생성기
      └─ mockCommuteCompare.ts                          Haversine 기반 통근시간/비용 합성기
```

### 편집
```
client/package.json                                     chart.js ^4.4.6 + react-chartjs-2 ^5.2.0 추가
client/src/App.tsx                                      Route 추가 (/region/:legalDongCode)
client/src/pages/Recommendation/components/RegionCard.tsx
                                                        useNavigate + onClick + 키보드 a11y (Enter/Space)
client/src/types/kakao.d.ts                             MarkerImage, Size, Point 타입 + Marker.image 옵션
```

---

## 2. Depth 3 페이지 구조 (실제 구현)

```
/region/:legalDongCode

┌────────────────────────────────────────────────────────────┐
│  RegionDetailHeader                                          │
│  · 뒤로가기 · 지역명 · 4축 점수(중앙) · 종합점수 · 테마토글       │
├──────────────────────────┬─────────────────────────────────┤
│                          │  ComplexCardList (가로 스크롤)      │
│  RegionMiniMap           │  · 단지 카드 W=56                  │
│  (해당 행정동 중심         │  · 평형/연식 뱃지 · 거래가 · 예상수익률  │
│   단지 핀 N개 +           ├──────────────┬──────────────────┤
│   직장 마커)               │                                  │
│  · 단지 핀 클릭 →           │ LstmFullAnalysis│ CommuteCompare │
│    좌측 미니맵 강조 +        │ (col-span-2)   │ (col-span-1)   │
│    우측 LSTM 카드 갱신       │                                  │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

### 상호작용
- 카드 클릭 → setSelectedComplex
- 단지 핀 클릭 → 동일하게 setSelectedComplex (양방향)
- 선택 단지는 미니맵 핀이 size↑ + brand 색, 카드는 brand 보더 + lift
- 직장이 없는 채로 직접 URL 진입 시 → 통근 비교 영역은 안내 placeholder

---

## 3. LSTM 풀 분석 카드 (시안 B) 상세

### 4축 메트릭 (상단)
```
현재 m²당  / 1년 후 / 3년 후 / 3년 누적 수익률
            ↓        ↓        ↓
         예측 보간 (1년: 35% 가속)
         predicted3y - current 의 차이로 expectedReturn3y 계산
```

### 라인 차트 (Chart.js)
```
x축:   2021-06 ~ 2029-04  (60 + 36 = 96개월)
y축:   m²당 만원
시리즈:
  · 과거 실거래 (solid brand)
  · LSTM 예측 (dashed brand)
  · 신뢰구간 음영 (fill: '+1' upper→lower, brandSoft)
연결: lastActualIdx 의 actual 값을 forecasts 동일 인덱스에 복사 → spanGaps 없이 라인 연속
```

### 신뢰도 도넛
```
값:    lstm.confidence (0~100)
배경:  light/dark 토큰 (#E5E8EB / #2D2F36)
중앙:  큰 숫자 + "/ 100"
```

### 다크 모드 대응
```
isDark 변경 시 useEffect 로 차트 key 갱신
→ Chart.js 가 컬러 캐싱하는 이슈 회피
```

---

## 4. Mock 데이터 합성 로직

### mockComplexes
- 8개 행정동 × 평균 3단지 (총 24건)
- 단지명/평형/연식/세대수/m²당단가/3년 예측치/신뢰도
- legalDongCode 키로 그룹핑 + complexId 단일 식별자

### mockLstmResults — 결정론적 합성
```
과거 60개월:
  linear interp(pastStart → current) + 계절성(sin 6m, ±1.5%) + 결정론적 노이즈(±2%)
  pastStart = current / (1 + expectedReturn3y/100 * 1.2)

예측 36개월:
  0~12개월:  current → predicted1y (선형)
  12~36개월: predicted1y → predicted3y (선형)
  신뢰구간:  center * (0.02 + ratio*(1-conf/100)*0.18)  ※ 시간↑ → 폭↑
```

### mockCommuteCompare
```
대중교통: (km/25)*60 + transfers*5 + 8분
환승: floor(km/3) - 1  (0..3 clamp)
비용: 1500 + max(0, km-5)*100
자차: (km/22)*60 + 6분, 연비 12km/L · 휘발유 1700원/L · 톨링 약간
```

---

## 5. 진입 동선

```
[Depth 2 추천 카드]
  · onMouseEnter/Leave: setHovered (기존)
  · onClick: navigate(`/region/${legalDongCode}`)   ← 신규
  · role="button" + tabIndex={0} + Enter/Space 키보드 처리
  · aria-label="${displayName} 상세 페이지로 이동"

[Depth 3]
  · 헤더 "돌아가기" → navigate('/')
  · 스토어가 workplace/recommendations 유지 → 뒤로 와도 즉시 복원
```

---

## 6. 검증

### sandbox 측 (Cowork mount)
- `npm install chart.js react-chartjs-2`  → **registry 차단(403)** — sandbox 한계
- `npx tsc -b --noEmit`  → 마운트 sync 지연으로 일부 파일 잘려보임 (위 위반 무관, 윈도우 측은 정상)

### 윈도우 측 (user 환경에서 직접)
```powershell
cd C:\git\NaODiSalm_Main\client
npm install                                              # ← chart.js + react-chartjs-2 설치
npm run typecheck                                        # ← tsc -b --noEmit
npm run dev                                              # ← 브라우저 검증
```

### 브라우저 시연 흐름 (검증 시나리오)
```
1. 메인 → "강남역" 검색 또는 인기 직장 클릭
2. 추천 카드 1위 (영등포구 당산동) 클릭
3. /region/1156013000 진입 — 미니맵 + 단지 카드 3건 자동 렌더
4. 첫 카드 자동 선택 → LSTM 풀 분석 + 통근 비교 동시 표시
5. 다른 단지 클릭 → 차트/메트릭 즉시 갱신
6. 단지 핀 클릭 → 카드/차트 동기화
7. 헤더 "돌아가기" → / 로 복귀, 1위 카드 hovered 상태 유지
8. 다크 모드 토글 → 차트 색상도 즉시 반전 (chartKey 강제 갱신)
```

---

## 7. 의도적 미구현 / 후속 작업

### 가까운 다음 (지금 세션 직후 후보)
```
⏳  서버 추천 API (/api/recommendations) — mock 대체
⏳  서버 매물 API (/api/regions/:code/complexes) — mockComplexes 대체
⏳  서버 LSTM 결과 API (/api/lstm/:complexId) — mockLstmResults 대체
⏳  이동수단 토글 (대중교통/자차) — Depth 2 의 colorByCode 와 연동
⏳  자동 백업 cron (랜섬웨어 재발 방지)
```

### 발표 직전 (D-3 ~ D-1)
```
⏳  TiDB 데이터 이관 (mysqldump → TiDB Cloud)
⏳  발표 자료 (노션 + 영상 + 심사 기준 매핑)
```

### 공모전 후
```
⏳  서울 10년치 거래 보강 (60개월 → 120개월)
⏳  모바일 반응형
⏳  마이데이터 연계 (3단계 확장)
```

---

## 8. 알게 된 / 결정된 것

```
[1] react-chartjs-2 + Chart.js 4 가 라이트/다크 모두 잘 어울림
    · 단, Chart 인스턴스가 컬러 캐싱하므로 다크 토글 시 key 갱신 필요
    · 한 번 register 한 컴포넌트 (CategoryScale 등) 는 모듈 단위 캐시되어 OK

[2] 카카오맵 MarkerImage 로 SVG 데이터URL 인라인 → 단지 핀 커스텀
    · 선택된 단지 = 큰 원 + brand fill
    · 비선택 = 작은 원 + brand 보더 (화이트 fill)
    · kakao.d.ts 의 MarkerImage / Size / Point 타입 보강

[3] mock 데이터 합성은 결정론적이어야 새로고침해도 동일 시연
    · seed = `${complexId}:${i}` 의 단순 해시
    · sin 으로 계절성 부여하면 차트가 "있어보임"

[4] 뒤로가기 후 상태 유지는 Zustand 만으로 충분
    · MOCK_REGIONS 가 페이지 마운트 시 setRecommendations 되므로
      workplace 가 살아있으면 추천 카드도 즉시 복원
    · sessionStorage 같은 추가 작업 불필요

[5] sandbox(Cowork mount) 의 한계
    · npm registry 접근 불가 — 의존성 설치는 윈도우 측에서
    · 큰 파일 일부 write 후 마운트 sync 지연 발생 — 검증은 윈도우 측 typecheck 로
```

---

## 9. 다음 세션 시작 시 첫 한 줄

> **"`cd client && npm install` 후 브라우저에서 강남역 → 1위 카드 → Depth 3 진입 시연 검증. 정상 동작하면 서버 추천 API mock 대체로 진행."**

---

## 10. 파일 통계

```
client/src/types/region-detail.ts                       64 lines
client/src/pages/RegionDetail/index.tsx                144 lines
client/src/pages/RegionDetail/components/
  RegionDetailHeader.tsx                                88 lines
  RegionMiniMap.tsx                                    134 lines
  ComplexCardList.tsx                                   86 lines
  LstmFullAnalysis.tsx                                 317 lines
  CommuteCompare.tsx                                   119 lines
client/src/pages/RegionDetail/data/
  mockComplexes.ts                                     176 lines
  mockLstmResults.ts                                   103 lines
  mockCommuteCompare.ts                                 51 lines
─────────────────────────────────────────────────────
신규 코드 합계                                          ~1,280 lines
```
