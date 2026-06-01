# Postman 가이드 — MOLIT RTMS (2026-05-30 추가분)

## 파일
- `MOLIT-RTMS-2026-05-30.postman_collection.json` — 요청 모음 (오피스텔/빌라/단독다가구 × 매매·전월세)
- `NaODiSalm-local.postman_environment.json` — 변수 모음 (serviceKey 등)

## Import (1분)
1. Postman 좌상단 **Import** → 위 두 파일 드래그
2. 우상단 Environment 드롭다운에서 **"NaODiSalm - local"** 선택
3. Environment 편집 → `serviceKey` 값 입력 후 저장

## serviceKey 주의 (가장 흔한 실수)
- data.go.kr 마이페이지 > 해당 활용신청 상세 > **일반 인증키(Decoding)** 값을 넣을 것
- Decoding 키를 넣어야 Postman이 자동으로 URL 인코딩함.
- Encoding 키(%2B, %3D 포함된 것)를 넣으면 이중 인코딩 → 인증 실패(SERVICE_KEY_IS_NOT_REGISTERED).

## 파라미터
- `LAWD_CD` : 시군구 5자리 (강남=11680, 마포=11440, 관악=11620 …)
- `DEAL_YMD`: 조회 계약월 YYYYMM (예: 202504)
- `numOfRows`: 한 페이지 건수 (1000), `pageNo`: 페이지 번호

## 응답 해석 (정상)
- `<resultCode>000</resultCode>` + `<totalCount>` + `<item>` 반복 = 성공
- 빈 달이면 items 비어있음(에러 아님)

## 자주 보는 실패
| 증상 | 원인 | 조치 |
|---|---|---|
| HTTP 403 | 해당 API 미승인 또는 승인 직후 키 미반영 | 승인 확인 후 잠시 뒤 재시도 |
| resultCode 30 (SERVICE_KEY_IS_NOT_REGISTERED) | Encoding 키 사용/오타 | Decoding 키로 교체 |
| resultCode 22 (LIMITED_NUMBER_OF...) | 일일 호출 한도 초과 | 다음날 또는 한도 상향 |

## 응답 필드 메모 (수집 코드 매핑 기준)
- 공통: dealYear/dealMonth/dealDay, excluUseAr(전용㎡), floor, buildYear, jibun, sggCd, umdNm
- 매매: dealAmount(만원)
- 전월세: deposit(보증금), monthlyRent(월세, 0이면 전세)
- 단지/건물명: 아파트 aptNm · 오피스텔 offiNm · 연립다세대 mhouseNm · 단독다가구 명칭없음(houseType)
- 단독다가구 면적: excluUseAr 없을 수 있음 → totalFloorAr(연면적) 사용

> 추후: 서버 external API(이 RTMS·TAGO·LH·부동산원 등) vs 내부 API 분리 문서를
>       이 2026-05-30 디렉토리에 정리 예정. 그때 이 컬렉션을 external 쪽 근거 자료로 참조.
