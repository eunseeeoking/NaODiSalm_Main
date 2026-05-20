# Depth 3 (지역 상세) 아키텍처 — 2026-05-20

> 1차 구현 완료 시점의 컴포넌트 트리 + 데이터 흐름.
> 서비스명 리브랜딩: "스마트 직세권" → **"나어디삶"** (rebranding.md 참고)

---

## 1. 라우트 + 진입 동선

```
/                              (Depth 2 — RecommendationPage)
   └─ RegionCard onClick
        navigate(`/region/${legalDongCode}`)
   ─────────────────────────────────────────►
/region/:legalDongCode         (Depth 3 — RegionDetailPage)
   └─ "돌아가기" → navigate('/')
        Zustand 가 workplace/recommendations 보존 → 즉시 복원
```

---

## 2. 컴포넌트 트리

```
RegionDetailPage  (index.tsx)
├─ RegionDetailHeader        ← 좌: 뒤로가기 + 브랜드 마크
│                              중: 4축 점수 (md+)
│                              우: 종합점수 + 테마 토글
│
├─ <main grid-cols-12>
│  ├─ col-span-4
│  │  └─ RegionMiniMap       ← 카카오맵 + 단지 핀 + 직장 마커
│  │       · 핀 클릭 → setSelectedComplex
│  │
│  └─ col-span-8 (flex-col)
│     ├─ ComplexCardList     ← 가로 스크롤 단지 카드
│     │      · 카드 클릭 → setSelectedComplex
│     │
│     └─ grid-cols-3 (flex-1)
│        ├─ col-span-2
│        │  └─ LstmFullAnalysis     ← 시안 B 풀카드
│        │       · 4축 메트릭 (현재/1년/3년/수익률)
│        │       · 라인 차트 (Chart.js, 60+36개월 + 신뢰구간)
│        │       · 신뢰도 도넛
│        │
│        └─ col-span-1
│           └─ CommuteCompare        ← 대중교통 vs 자차
│                · 편도 시간/비용/환승
│                · 월 통근비 차이
```

---

## 3. 데이터 흐름

```
                ┌──── MOCK_REGIONS (data/mockRegions.ts) ────┐
                │                                              │
                ▼                                              │
        regionMeta (RegionRecommendation)                      │
                │                                              │
   /region/:code 진입                                          │
                │                                              │
                ├─► getMockComplexesForRegion(code)            │
                │    └─► complexes: AptComplex[]               │
                │                                              │
                ├─► [첫 단지 자동 selected]                     │
                │                                              │
                ├─► getMockLstm(selectedComplexId)             │
                │    └─► LstmAnalysis                          │
                │         · series (60+36 LstmPoint)            │
                │         · current/1y/3y/return                │
                │         · confidence                          │
                │                                              │
                └─► getMockCommuteCompare(complexId, workplace)│
                     └─► CommuteCompareData                     │
                          · transitMinutes/transfers/cost        │
                          · carMinutes/cost                     │
                                                                │
   selectedComplex 변경 시 ── getMockLstm + getMockCommuteCompare 재호출
```

---

## 4. mock → 실 API 매핑 (다음 단계 설계)

| Mock 함수 | 대체 API 엔드포인트 | 응답 형태 |
|---|---|---|
| `getMockComplexesForRegion(code)` | `GET /api/regions/:code/complexes` | `AptComplex[]` |
| `getMockLstm(complexId)` | `GET /api/lstm/:complexId` | `LstmAnalysis` |
| `getMockCommuteCompare(complexId, wp)` | `GET /api/commute/compare?complexId=&wpLat=&wpLng=` | `CommuteCompareData` |

mock 시그니처와 응답 모양이 동일하도록 설계 → 실 API 도착 시 호출부만 교체.

---

## 5. 상태 관리 (Zustand)

```
useRecommendationStore
  · workplace          ← Depth 2 에서 입력, Depth 3 에서 통근 비교에 사용
  · recommendations    ← Depth 2 에서 채워짐, /region/:code 진입 시 region 메타 찾기에 사용
  · hoveredRegion      ← Depth 2 카드↔지도 양방향용 (Depth 3 에서는 미사용)

useThemeStore
  · theme              ← Depth 2/3 헤더 동일하게 구독
  · toggle             ← 양쪽 헤더 모두 토글 버튼 제공

(로컬 state)
RegionDetailPage.selectedComplex      ← 현재 활성 단지
```

---

## 6. 컴포넌트 책임 정리

| 컴포넌트 | 책임 | 외부 의존 |
|---|---|---|
| `RegionDetailPage` | 라우트·상태 조합 + 빈 상태 처리 | `useParams`, store, mock 데이터 |
| `RegionDetailHeader` | 헤더 시각 + 뒤로가기 + 테마 토글 | `useThemeStore` |
| `RegionMiniMap` | 카카오맵 인스턴스 + 마커 라이프사이클 | `useKakaoLoader`, `window.kakao` |
| `ComplexCardList` | 가로 스크롤 + 선택 강조 | (없음, pure) |
| `LstmFullAnalysis` | 시계열 차트 + 도넛 + 메트릭 | `chart.js` + `react-chartjs-2`, `useThemeStore` |
| `CommuteCompare` | 두 모드 비교 + 월 차액 | (없음, pure) |

대부분의 컴포넌트가 **pure presentation** → 단위 테스트 가능 + 실 API 교체 시 컴포넌트 무변경.

---

## 7. 알게 된 트레이드오프

```
[1] LSTM 차트의 신뢰구간 렌더링
    · Chart.js fill: '+1' 로 upper → lower 사이 음영
    · 단점: legend 에 "예측 상한/하한" 항목이 노출되어 산만
    → labels.filter 로 노출 항목 가림 처리

[2] 다크 모드 전환 시 Chart.js 색상 캐싱
    · register 한 컴포넌트는 모듈 단위 캐시 OK
    · 인스턴스의 colors 는 props 로 받지만 캐시되어 toggle 즉시 미반영
    → key={`line-${isDark}`} 강제 재마운트

[3] 카카오맵 SVG 데이터URL 인라인 마커
    · 장점: 외부 이미지 호스팅 불필요, 색상 동적 변경 가능
    · 단점: SVG 문자열 안에 encodeURIComponent 필요 (특히 # → %23)
    → 일관된 인라인 헬퍼로 처리

[4] mock 결정론
    · seed = `${complexId}:${i}` 의 단순 hash
    · 매 호출마다 동일 시계열 → 새로고침해도 동일 시연 보장
    → 실 API 도착 후 제거할 부분이 명확

[5] Depth 3 진입 후 store 유지
    · sessionStorage 별도 작업 없이 Zustand 만으로 충분
    · React Router 가 마운트만 분리하고 컴포넌트 상태는 분리하지 않으므로
      RecommendationPage 외부의 store 가 그대로 살아있음
```

---

## 8. 추후 개선 후보 (Depth 3 자체에 한정)

```
[a] complex 핀 hover ↔ 카드 hover 양방향 (Depth 2 의 hoveredRegion 패턴과 동일)
[b] LSTM 라인 차트 hover tooltip 에 신뢰구간 폭 표시
[c] CommuteCompare 에 환승 노선 미리보기 (ODsay 응답 활용)
[d] 단지 카드에 학군/생활편의 점수 노출 (점수 계산 알고리즘 도착 후)
[e] URL 쿼리 파라미터로 selectedComplexId 보존 → 공유 시 동일 단지 진입
```
