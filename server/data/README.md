# server/data — 시드용 외부 데이터

이 폴더의 `*.csv`/`*.zip`은 gitignore 대상(대용량·외부 출처). 아래 파일을 직접 받아 두면 시드가 사용합니다.

## seoul-bus-stops.csv — 서울 대중교통 품질(transit) 시드용

서울 TOPIS 라이브 API(ws.bus.go.kr) 폐기 후, 서울 버스정류소 **밀도**(동 centroid 반경 1km 정류소 수)로
`transitScore`를 산출하는 데 쓰입니다. 경기·인천은 기존 TAGO 라이브 유지.

### 받는 곳
공공데이터포털 **국토교통부_전국 버스정류장 위치정보**
<https://www.data.go.kr/data/15067528/fileData.do> (로그인 없이 파일 다운로드, 전국·서울 포함)

### 두는 법
받은 CSV를 그대로 `server/data/seoul-bus-stops.csv` 로 저장.
- 컬럼: 정류장번호·정류장명·**위도·경도**·… (순서/인코딩 무관 — 좌표 범위로 자동 파싱)
- 서울권 bbox(위도 37.35~37.75 · 경도 126.70~127.25)만 자동 필터 → 전국 파일 그대로 OK.
- 경로 변경: `.env` 에 `SEOUL_BUS_STOPS_CSV=<절대경로>`.

### 시드 실행
```
cd server
npm run seed:transit            # 서울=정적 파일, 경기인천=TAGO(MOLIT 키 필요)
# 서울 정적 로딩 진단: SEOUL_BUS_DEBUG=1
```
파일이 없으면 서울은 안전 폴백(미적재 → transitScore null). 적재 후 통계(min/avg/max)를 보고
`seoulBusStopTransit.ts` 의 `STATION_SATURATION`(기본 40) 조정 가능.
