# 비-아파트 전월세 수집·적재 (오피스텔/연립다세대/단독다가구)

> 2026-05-29 · 청년 타깃 전월세 데이터 보강.
> 결론: 새 파이프라인을 만들 필요 없었음. 기존 아파트 RTMS 파이프라인을 유형 범용으로 확장.

## 무엇이 비어 있었나

기존 코드에 이미 다음이 완성돼 있었음:
- `src/services/external/molit.ts` — 국토부 RTMS 클라이언트 (XML 파싱·페이징·쿼터 처리·정규화)
- `src/services/ingest/aptIngest.ts` — 단지 매칭 + 매매/전월세 upsert
- `scripts/bulkIngestApt.ts` — 서울 25구 × N개월 배치 + 체크포인트 재개
- DB: `t_apt_rent` 에 아파트 전월세 약 119만 건 이미 적재

빈 칸은 두 개뿐이었다:
1. molit.ts 에 offi 엔드포인트는 있었으나 fetch 함수 없음
2. 빌라(연립다세대)·단독다가구는 엔드포인트조차 없음

## 이번에 추가한 것

### 1) molit.ts — 유형 범용화
- `PropertyType = 'APT' | 'OFFI' | 'VILLA' | 'SH'`
- `PROPERTY_ENDPOINTS` 4종 매매/전월세 엔드포인트
  - APT  : RTMSDataSvcAptTradeDev / AptRent       (승인 OK)
  - OFFI : RTMSDataSvcOffiTrade / OffiRent         (승인 OK)
  - VILLA: RTMSDataSvcRHTrade  / RHRent            (활용신청 필요)
  - SH   : RTMSDataSvcSHTrade  / SHRent            (활용신청 필요)
- `fetchTradesByType(type, lawd, ym)` / `fetchRentsByType(...)`
- `pickName()` — aptNm/offiNm/mhouseNm/houseType 다중 폴백 (단독다가구는 이름 없어 "법정동 지번"으로 합성)
- `pickArea()` — excluUseAr 없으면 totalFloorAr(연면적) 사용 (단독다가구)
- 기존 `fetchAptTrades/fetchAptRents` 는 래퍼로 유지 (aptIngest.ts 무수정)

### 2) Prisma — 유형별 분리 테이블 (server + ML mirror)
아파트(`t_apt_*`)는 그대로 두고 신규:
- `t_offi_complex` / `t_offi_trade` / `t_offi_rent`
- `t_villa_complex` / `t_villa_trade` / `t_villa_rent`
- `t_sh_complex` / `t_sh_rent`  (단독다가구는 매매 테이블 없음)

ML 쪽 schema.prisma 에도 read-only mirror 추가.

### 3) ingest + CLI
- `src/services/ingest/realtyIngest.ts` — `ingestRealtySigunguMonth(type, sigungu, ym)`
  비-아파트는 aptSeq 없으므로 (sigungu+legalDong+name+builtYear) fingerprint 매칭만 사용.
- `scripts/bulkIngestRealty.ts` — `--type` 플래그(콤마 다중), 유형별 체크포인트 재개
- package.json: `npm run ingest:realty:bulk`

## 실행 순서 (사용자 머신 = Windows)

```powershell
cd C:\git\NaODiSalm_Main\server

# 0. Prisma 클라이언트 재생성 + 신규 테이블 생성
npx prisma generate
npx prisma migrate dev --name add_realty_rent_tables   # 또는: npx prisma db push

# 1. (검증) 단일 구·단일 월로 응답 필드명 확인 — bulk 돌리기 전 필수
$env:MOLIT_DEBUG="1"
npm run ingest:realty:bulk -- --type=OFFI --from=202504 --to=202504 --codes=11680
#  → 콘솔의 response(head 600) 에서 offiNm/excluUseAr/deposit/monthlyRent 태그 확인.
#    만약 태그명이 다르면 molit.ts 의 pickName/pickArea/RawAptRent 에 키 추가.
Remove-Item Env:\MOLIT_DEBUG

# 2. 오피스텔 본 적재 (서울 25구, 최근 2년)
npm run ingest:realty:bulk -- --type=OFFI --from=202405 --to=202604

# 3. (승인 후) 빌라·단독다가구
npm run ingest:realty:bulk -- --type=VILLA,SH --from=202405 --to=202604
```

## 활용승인 현황 (2026-05-29 기준, 4종 전월세 전부 승인 완료)

| 유형 | 전월세 | 매매 |
|---|---|---|
| 아파트 | ✅ | ✅ |
| 오피스텔 | ✅ | ✅ |
| 단독/다가구 | ✅ | ✅ |
| 연립다세대(빌라) | ✅ | ✅ |

- 전월세 4종 모두 적재 가능. 아파트는 기적재(약 119만 건).
- 지금 실행: `--type=OFFI,VILLA,SH` (전월세). 매매는 청년 타깃 후순위 — 전세가율/LSTM 보조지표용으로 선택 적재.
- bulk 전 반드시 `MOLIT_DEBUG=1` 단일 구·월 dry-probe 로 각 유형 응답 필드명 확인 (특히 VILLA=mhouseNm, SH=연면적 totalFloorAr·이름 없음).
