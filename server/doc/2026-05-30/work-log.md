# 작업일지 2026-05-30

## 0. 한 줄 요약
청년 타깃에 안 맞던 "고가 아파트 매매" 편중을 깨고, 국토부 RTMS 전월세 4종(아파트·오피스텔·연립다세대·단독다가구)을 수집·적재해 분석 기반을 전월세 시세로 전환. 데이터 소스 한 칸을 채워 가성비/통근/LSTM 분석을 되살리는 작업.

---

## 1. 이번 세션 작업 내용 (완료)

### 1-1. 데이터 소스 진단
- 기존에 이미 검증된 TS 수집 파이프라인이 있었음 (Python/PublicDataReader 신규 불필요).
  - `src/services/external/molit.ts` — RTMS 클라이언트 (XML 파싱·페이징·쿼터/에러 처리·정규화)
  - `src/services/ingest/aptIngest.ts` — 단지 매칭 + 매매/전월세 upsert
  - `scripts/bulkIngestApt.ts` — 서울 25구 × N개월 배치 + 체크포인트 재개
  - DB: `t_apt_rent` 에 아파트 전월세 약 119만 건 기적재
- 빈 칸: ① molit 에 offi fetch 함수 없음 ② 빌라·단독다가구 엔드포인트 자체가 없음.

### 1-2. molit.ts 유형 범용화
- `PropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH'` + `PROPERTY_ENDPOINTS`(4종 매매/전월세).
- `fetchTradesByType()` / `fetchRentsByType()` 추가, 기존 `fetchAptTrades/Rents`는 래퍼로 보존.
- `pickName()` — 유형별 건물명 태그 차이 흡수:
  - 아파트 aptNm · 오피스텔 offiNm · 연립다세대 mhouseNm
  - 단독/다가구: 건물명 없음 → "법정동 지번", 지번도 없으면 "법정동 유형"(예: 역삼동 다가구)
  - (houseType 은 분류값이라 건물명으로 쓰지 않도록 수정 — 초기 버그 잡음)
- `pickArea()` — excluUseAr 없으면 totalFloorAr(연면적) 사용 (단독/다가구).

### 1-3. DB 스키마 — 유형별 분리 테이블 (결정: discriminator 컬럼 대신 분리)
- 아파트는 기존 `t_apt_*` 유지. 신규:
  - `t_offi_complex` / `t_offi_trade` / `t_offi_rent`
  - `t_villa_complex` / `t_villa_trade` / `t_villa_rent`
  - `t_sh_complex` / `t_sh_rent` (단독/다가구는 매매 테이블 미생성)
- ML 쪽 `prisma/schema.prisma` 에도 read-only mirror 추가.

### 1-4. ingest + CLI
- `src/services/ingest/realtyIngest.ts` — 타입 config 기반 `ingestRealtySigunguMonth(type, sigungu, ym)`.
  비-아파트는 aptSeq 없으므로 (sigungu+legalDong+name+builtYear) fingerprint 매칭.
- `scripts/bulkIngestRealty.ts` — `--type`(콤마 다중), 유형별 체크포인트 재개.
- `package.json`: `npm run ingest:realty:bulk`.

### 1-5. 활용승인 (최종: 전월세 4종 + 매매 대부분 승인 완료)
- 키는 계정당 1개(MOLIT_SERVICE_KEY) 공유, 승인은 API별. Postman으로 6종 응답 검증 완료.

### 1-6. Postman 정비
- `doc/2026-05-30/postman/` 에 컬렉션 + 환경 + README 작성.
  - 오피스텔/빌라/단독다가구 × 매매·전월세.
  - serviceKey 는 Decoding 키 사용(이중 인코딩 주의), 변수: lawdCd/dealYmd/pageNo/numOfRows.
- (추후) 서버 external API vs 내부 API 분리 문서를 이 디렉토리에 정리 예정 → 그때 이 컬렉션을 external 근거로 참조.

### 1-7. 적재 결과 (최근 24개월: 202405~202604, 서울 25구)
- OFFI(오피스텔) 전월세: 누적 rents 179,080 · 단지 55,348 · 600/600 step · 실패 0
- SH(단독/다가구) 전월세: 누적 rents 302,789 · 단지 120,854 · 600/600 step · 실패 0
- VILLA(연립다세대): 동일 명령에 포함 (수치 재확인 필요 — `npm run db:snapshot` 으로 t_villa_rent count 확인)
- APT(아파트): 기적재 약 119만 건.
- 검증 TODO: db:snapshot 으로 t_offi_rent / t_villa_rent / t_sh_rent row 수 갱신.

---

## 2. 데이터 특성 메모 (분석 설계에 직결)
- 이 데이터는 "현재 매물"이 아니라 "최근 실제 계약된 전월세 신고가" = 시세 데이터. 의사결정 도구에 더 적합.
- 단독/다가구 전월세는 국토부가 지번·층 미제공(개인정보) → 개별 건물 식별 불가.
  → "complex"가 동 단위로 뭉침. 단지 추적 불가, 그러나 "동별 다가구 전세 시세 통계"로는 적합.
- 유형 매핑: 빌라=연립/다세대 · 원룸≈오피스텔/단독다가구 · 오피스텔=오피스텔.

---

## 3. UI / 분석 설계 방향 (이번 세션 아이디어 — 다음 세션 구현 검토)

### 3-1. Depth 3 (지역 상세) — 전월세는 표출 방식이 달라야 함
- 현재 3뎁스 = "매물(단지) 기준 상세 분석".
- 전월세(특히 단독/다가구·빌라)는 단지 식별이 약하므로, 3뎁스를
  **동 단위 시세 통계**(중위 보증금/월세, 면적대별 시세, 최근 추세)로 표출.
- 아파트/오피스텔처럼 단지 식별이 되는 유형은 기존 단지 상세 유지 가능 → 유형에 따라 3뎁스 뷰 분기.

### 3-2. Depth 2 (지도/리스트) — 필터 & 핀
- 매물 종류 체크박스(아파트 / 빌라 / 오피스텔 [/ 단독다가구])로 지도 핀 on/off.
- 거래유형 체크박스(매매 / 전세 / 월세).
- 조회범위 유동성: 반경 또는 행정구역(구/동) 단위 조절 — 데이터 밀도에 따라 가변.
- 빈 결과 방지: 선택 조건에 데이터 없으면 안내 + 범위 확장 제안.

### 3-3. 가중치 기반 순위 점수 — 타입별 분리
- 아파트/빌라/오피스텔 × 매매/전세/월세 각 조합별로 가중치 반영 순위 점수 리스트업.
- 지역 카드별 체크박스 선택에 따라 **매매점수 / 전세점수 / 월세점수**를 분리 산출·표시.
  → 사용자가 "전세 기준으로 보고 싶다" 하면 전세점수 기반 랭킹으로 카드 재정렬.
- 가성비 점수 입력값을 (고가 매매 대신) 선택된 거래유형의 전월세 시세 기반으로 교체.

### 3-4. 정체성 가드레일
- "다방 짝퉁"(매물 검색 강화)으로 가지 말 것. 우리는 가중치 기반 의사결정 도구.
  데이터는 실거래가(시세) 기반 분석용으로만 사용.

---

## 4. 다음 세션 TODO
- [o] db:snapshot 으로 신규 4 테이블 row 수 확정 + db-state.md 갱신.
- [ ] 조회/스코어링 레이어에 유형·거래유형 필터 추가 (realtyRepository, scoring).
- [ ] Depth2 체크박스 핀 + 조회범위 토글.
- [ ] Depth3 전월세용 "동 단위 시세 통계" 뷰 분기.
- [ ] 타입별(매매/전세/월세) 점수 분리 설계 → 가중치 모델 확장.
- [ ] LSTM: 전월세 시계열 예측 가능 구간 검토 (2차 멘토링 방향 받은 뒤).
- [ ] external API vs 내부 API 분리 문서 작성 (Postman 컬렉션 연계).
- [ ] 데모 시나리오 1개 end-to-end ("서울/경기, 전세 2억 이하, 원룸/오피스텔").
- [ ] 다음 세션: 차별화 아이디어 브레인스토밍.
