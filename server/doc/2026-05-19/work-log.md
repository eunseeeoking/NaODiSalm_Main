# 작업 로그 — 2026-05-19

## 한 줄 요약

> Linear 다크 톤 → 토스 한국형으로 디자인 전환 + 행정동 통근 히트맵 + ODsay 매트릭스 캐싱 (KNN 격자 확장) 완성.
> **중간에 MySQL 랜섬웨어 공격으로 DB 전체 유실. 백업 복구 후 보안 강화 완료.** (별도 섹션 참고)

---

## 0. 인프라 메모 (전체 프로젝트 공통, 후임 참고용)

### 운영 구성

```
Client    Vercel (자동 배포)        ← GitHub 커밋 시 자동 빌드 + 배포
Server    Render (자동 배포)        ← GitHub 커밋 시 자동 빌드 + 배포
DB        Docker MySQL (로컬, 개발) + TiDB Cloud (배포용, 대기)
ML        로컬 PC (장기 학습 무한 루프, 결과만 DB upsert)
```

### TiDB Cloud 인스턴스 정보

```
Instance Name      molit-2026
Instance ID        10939552001829638334
Status             Active
TiDB Version       v8.5.3
Cloud Provider     AWS
Region             Tokyo (ap-northeast-1)
Created by         kakkumok2009@gmail.com
Created at         2026-05-14 13:50:25
High Availability  Zonal
```

### 현재 라우팅

```
[로컬 개발]   npm run dev    → host 의 Docker MySQL (localhost:3306)
[배포 운영]   Vercel ↔ Render → DATABASE_URL 이 이미 TiDB 향함 (빌드 오류 상태)
              ※ 현재 운영 서버 미동작 — 의도된 상태 (외부 노출 없음 = 보안 안전)
```

### 데이터 이관 계획 (심사 직전)

```
1. 로컬 MySQL 데이터 mysqldump
2. TiDB Cloud 로 import (MySQL 8.0 호환)
   → 이관 완료 시점부터 Render server 자동 빌드 통과 → 운영 라이브
3. 라이브 데모는 TiDB 백엔드 기반

→ 발표 시연 시 도메인 한 번에 정상 동작 보장

※ 이관 전까지 운영 빌드 오류는 그대로 둔다 (서버 안 돌면 추가 보안 사고 위험 0)
```

### 보안 사고 후 영구 적용 (이번 일지 5번 섹션 참고)

```
docker-compose.yml      ports: "127.0.0.1:3306:3306" + env 비밀번호
.env                    .gitignore 처리 (절대 커밋 금지)
방화벽                  3306 외부 차단 (Windows Defender)
```

---

## 1. 디자인 톤 전환

### Linear/Vercel 다크 → 토스 한국형
- 사용자 피드백: 폰트 안 보임 + 올드함 → 톤 전면 교체
- A 후보(Linear) 적용 후 B 후보(토스)로 재전환

### 적용 사항
```
배경    화이트 → 부드러운 회색 #F5F6F8  (라이트) / #17171C (다크)
액센트  Cyan #22D3EE → 토스 블루 #3182F6
수익률  → 그린 #15B970 강조
폰트    Inter+Mono → Pretendard Variable 단독 (한글 가독성)
라운드  10px → 12~16px
그림자  없음 → 부드러운 lift hover
가중치  500/600 위주 → 600/700 (bold·extrabold)
```

### 한글 라벨 통일
```
commute patience → 통근 인내심
weights          → 가중치
worker/investor/resident → 직장인/투자자/실거주
cmt/val/inv/life → 통근/가성비/투자/생활
regions found    → 추천 지역 N건
popular          → 인기 직장
budget           → 예산
```

### 다크/라이트 토글
- `useThemeStore` + persist 미들웨어
- 헤더 우측 토글 버튼 (해/달 아이콘)

---

## 2. 행정동 통근 히트맵 (정적)

### 데이터 소스
- GitHub `vuski/admdongkor` 공개 GeoJSON
- 전국 ~3,500개 → 서울 25개구 ~470개 필터링
- 전처리 스크립트: `server/scripts/extract-seoul-hjd.ts`

### 산출물 (client/public/data/)
- `seoul-hjd-simplified.geojson` (823KB)
- `seoul-centroids.json` (74KB)

### 컴포넌트/훅
- `useChoroplethLayer` — 카카오맵 Polygon 오버레이 hook (재사용 가능)
- `commuteEstimate.ts` — Haversine 거리 + 5단계 색상 매핑
- MapPanel 통합 — 직장 좌표 기반 즉시 색칠

---

## 3. 통근 매트릭스 백엔드 (ODsay 연동)

### 신규 테이블
- `t_commute_matrix` (Prisma model `CommuteMatrix`)
- cacheKey + legalDongCode 복합 unique

### 코드 자산
```
server/src/services/external/odsay.ts            ODsay 호출 + rate-limit 배치
server/src/services/repositories/commuteRepository.ts  KNN 격자 검색 + upsert
server/src/routes/domains/commute.ts             POST /api/commute/matrix
```

### API 응답
```json
{
  "cacheKey": "37.4979_127.0276",
  "cacheHit": 420,      // 정확 좌표 일치
  "cacheNearby": 30,    // KNN 격자 흡수 (33m 이내)
  "cacheMiss": 20,      // 신규 ODsay 호출
  "written": 20,
  "elapsedMs": 850,
  "matrix": { ... }
}
```

### 클라이언트 통합
- `client/src/api/commute.ts` — fetch 래퍼
- MapPanel 에 매트릭스 fetch + Haversine fallback 동시 색칠
- 좌상단 진행 배지 (로딩 / 정확 / 근접 / 신규 통계)

---

## 4. KNN 격자 확장 검색 v1.1

### 동기
- 광화문 30m 옆 빵집 입력 → 신규 470건 호출 비효율
- 일 1000건 한도 빠르게 소진

### 구현
```
조회:  origin 주변 3×3 격자 9개 cacheKey 일괄 IN 검색
       각 행정동마다 origin 에 가장 가까운 워크포인트 캐시 선택
저장:  정확 cacheKey 로만 (캐시 누적되어 KNN 정확도 ↑)
```

### 효과
- 같은 빌딩 다른 입구 → exact hit
- 30m 이내 인접 좌표 → nearby hit (호출 0)
- 200m 이상 떨어지면 여전히 miss

### 문서
- `server/doc/commute-cache-logic.md` (v1.1 섹션 추가)

---

## 5. 보안 사고 ⚠️ MySQL 랜섬웨어 공격

> **후임 개발자 필독.** 같은 실수 반복 방지용.

### 발생 경위
1. `docker-compose.yml` 에 `ports: "3306:3306"` 설정 — **0.0.0.0** 으로 외부 노출
2. `MYSQL_ROOT_PASSWORD: root` — **자동 봇이 가장 먼저 시도하는 약한 비번**
3. 외부 자동 봇이 인터넷 스캔 → 3306 열린 IP 찾음 → `root/root` 로그인 성공 → 모든 테이블 DROP

### 발견 흔적
```sql
SHOW TABLES;
-- 결과:
--   RECOVER_YOUR_DATA_info      ← 비트코인 결제 요구 메시지
--   view_apt_complex_health     ← (원본 뷰 일부 잔존)
```

### 절대 하지 말 것
```
⛔ 비트코인 결제 — 결제해도 데이터 복구율 0%. 공격자에게 자금만 줌.
```

### 즉시 대응 (실제 적용한 순서)
1. Windows 방화벽 활성화 + 3306 외부 차단
2. `root@'%'` 제거 (외부 root 접근 봉쇄)
3. `docker-compose.yml` 수정 — `ports: "127.0.0.1:3306:3306"`
4. 비밀번호 `.env` 환경변수로 분리 + 강력한 값
5. `RECOVER_YOUR_DATA_info` / 잔존 view 삭제
6. SQL 백업 (어제 내보내기 해둠) import 로 데이터 복구
7. Prisma `migrate resolve --applied` 로 마이그레이션 히스토리 baseline
8. ODsay 강남역/광화문 다시 캐싱 → 일 1000건 한도 내 940건 소모

### 잃은 데이터
```
t_user             — 1건 (테스트 계정만, 손실 0)
t_commute_matrix   — 강남역/광화문 캐시 (다시 호출하면 됨, 일 한도만 신경)
나머지              — 백업으로 100% 복구
```

### 영구 차단 조치
```yaml
# docker-compose.yml
ports:
  - "127.0.0.1:3306:3306"   # ← host 의 localhost 만 노출
environment:
  MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD must be set in .env}
  MYSQL_PASSWORD:      ${MYSQL_PASSWORD:?MYSQL_PASSWORD must be set in .env}
```

```
.env (루트, .gitignore 처리됨)
MYSQL_ROOT_PASSWORD=<16자 이상 강력한 비밀번호>
MYSQL_PASSWORD=<앱 계정용 별도 비밀번호>
```

### 교훈 — 후임에게 전하는 4가지

```
[1] 개발용 DB 라도 절대 0.0.0.0 노출 금지
    "로컬이라 외부 접근 안 되겠지" 는 잘못된 가정
    공유기 포트포워딩 / VPN / DDNS 등으로 알게 모르게 열릴 수 있음

[2] 비밀번호 "root/root" 같은 약한 값은 자동 봇이 1분 안에 뚫음
    docker-compose 환경변수도 .env 로 분리

[3] 백업은 "있다" 가 아니라 "복원된다" 가 진짜
    어제 SQL 내보내기 덕에 살았음 — 자동 백업 cron 등록 강력 권장
    예: Windows 작업 스케줄러 + mysqldump 매일 자동 실행

[4] 정기 점검
    netstat -ano | findstr :3306
    SHOW DATABASES; SELECT user, host FROM mysql.user;
    이 두 줄로 외부 노출 + 의심 계정 매주 확인
```

### 자동 백업 스크립트 (권장)
```powershell
# C:\backups\auto-backup.ps1
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
docker exec molit-mysql mysqldump --user=root --password=$env:MYSQL_ROOT_PASSWORD `
  --single-transaction --quick --routines --triggers `
  --default-character-set=utf8mb4 --hex-blob `
  molit_contest > "C:\backups\molit_$ts.sql"

# 7일 이상 자동 정리
Get-ChildItem C:\backups\molit_*.sql |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
  Remove-Item
```
Windows 작업 스케줄러 → 매일 03:00 → 위 스크립트 실행 등록.

---

## 6. 작성/수정 파일 통합

### 신규
```
server/scripts/extract-seoul-hjd.ts
server/src/services/external/odsay.ts
server/src/services/repositories/commuteRepository.ts
server/src/routes/domains/commute.ts
server/doc/commute-cache-logic.md
client/public/data/seoul-hjd.geojson (외부 다운로드)
client/public/data/seoul-hjd-simplified.geojson
client/public/data/seoul-centroids.json
client/src/api/commute.ts
client/src/pages/Recommendation/hooks/useChoroplethLayer.ts
client/src/pages/Recommendation/utils/commuteEstimate.ts
client/src/stores/useThemeStore.ts
```

### 편집
```
server/prisma/schema.prisma                    CommuteMatrix 모델 추가
server/prisma/migrations/20260519105156_add_commute_matrix/
server/.env.example                            ODSAY_API_KEY 추가
server/src/routes/api.ts                       /api/commute 마운트
client/tailwind.config.ts                      토스 디자인 토큰
client/src/css/index.css                       Pretendard 폰트 + 토스 슬라이더
client/src/types/kakao.d.ts                    Polygon + services.Places 타입
client/src/App.tsx                             테마 effect
client/src/pages/Recommendation/index.tsx
client/src/pages/Recommendation/components/*.tsx  (8개 — 토스 톤 + 한글)
docker-compose.yml                             보안 강화 (랜섬웨어 후속)
```

---

## 7. 알려진 미구현 (의도적 — 다음 단계)

```
✅  행정동 폴리곤 통근 히트맵          (완료)
✅  ODsay 통근 매트릭스 캐시          (완료)
✅  KNN 격자 확장 검색                (완료)
✅  카드↔지도 양방향 호버              (완료)
⏳  Depth 3 (지역 상세 + 매물 + LSTM) ← 다음
⏳  서버 추천 API (/api/recommendations)  mock → 실제 점수
⏳  Depth 1 입력 페이지                후순위
⏳  이동수단 토글 (대중교통/자차)        가벼운 폴리시
⏳  모바일 반응형                      공모전 이후
```

---

## 8. 다음 우선순위

```
[A] Depth 3 지역 상세 페이지         ← 발표 시연 흐름 완성
[B] 서버 추천 API mock 대체           ← 진정성
[C] 이동수단 토글                     ← 30분 작업 폴리시
[D] 자동 백업 cron                    ← 보안 사고 재발 방지
```

오늘 마지막 통과: Depth 3 진입.
