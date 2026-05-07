# 2026_MOLIT_CONTEST

Vite + React + TypeScript 클라이언트와 Express + TypeScript 서버로 구성된 모노레포입니다.

## 폴더 구조

```
.
├── client/   # Vite + React + TypeScript SPA
├── server/   # Express + TypeScript API 서버
└── package.json  # npm workspaces 루트
```

## 요구사항

- Node.js 18.18 이상
- npm 9 이상

## 시작하기

```bash
# 1) 루트에서 한 번만 설치 (workspaces가 client/server를 함께 설치합니다)
npm install

# 2) 개발 모드 (client + server 동시에 실행)
npm run dev

# 3) 프로덕션 빌드
npm run build

# 4) 빌드된 서버 실행
npm start
```

기본 포트:

- 클라이언트: http://localhost:5173
- 서버 API:  http://localhost:4000

클라이언트의 Vite dev server는 `/api` 경로를 서버(`http://localhost:4000`)로 프록시합니다.

## DB (MySQL + Prisma)

### 1) MySQL 띄우기 (Docker)

```bash
docker compose up -d
```

또는 로컬 MySQL을 사용하는 경우 `molit_contest` DB를 직접 생성하세요.

### 2) 환경변수 설정

```bash
cp server/.env.example server/.env
# DATABASE_URL 을 실제 계정으로 수정
```

### 3) Prisma 마이그레이션

```bash
# 스키마 변경 → 마이그레이션 생성/적용 + Client 재생성
npm --workspace server run prisma:migrate -- --name init

# 스키마는 그대로 둔 채 Client 만 재생성
npm --workspace server run prisma:generate

# 데이터 GUI
npm --workspace server run prisma:studio
```

### 4) DB 레이어 구조

```
server/
├── prisma/schema.prisma                       ← 스키마 정의(SSOT)
└── src/
    ├── services/
    │   ├── db.ts                              ← PrismaClient 싱글톤
    │   └── repositories/userRepository.ts     ← 도메인별 질의 함수
    └── routes/domains/users.ts                ← HTTP 핸들러 (repository 호출만)
```

원칙: 라우트 핸들러는 `prisma.*` 를 직접 부르지 않고 repository 함수만 호출합니다.

## 임시 운영 (1달, 무료)

본 프로젝트는 공모전 기간(약 1달) 동안 **클라우드 DB 없이** 운영하도록 셋업되어 있습니다.

### 모드 1: 로컬 only (권장 — 시연이 본인 PC에서 진행되는 경우)

```bash
# 매번 시작 시
docker compose up -d            # MySQL
npm run dev                     # client + server 동시

# 종료 시
docker compose down             # MySQL 컨테이너 정지 (데이터는 volume 에 보존)
```

### 모드 2: 외부 평가용 — Cloudflare Tunnel

평가위원이 외부에서 접근해야 하는 경우, 평가 시간만 임시 HTTPS URL을 발급합니다. 카드/계정 불필요.

```bash
# 최초 1회 설치
winget install --id Cloudflare.cloudflared       # Windows
brew install cloudflared                         # macOS

# 평가 시작 직전: 서버(4000) 만 외부에 노출
cloudflared tunnel --url http://localhost:4000
# 출력된 https://*.trycloudflare.com URL 을 평가위원에게 전달

# 평가 종료 후 Ctrl+C 로 즉시 종료 → 외부 접근 차단
```

⚠️ **DB(3306) 는 절대 외부에 노출하지 않습니다.** 서버 포트(4000)만 노출하고, DB는 Docker 컨테이너 내부 네트워크로만 접근합니다.

### 시연 체크리스트

- [ ] `docker compose ps` 로 mysql 컨테이너 정상
- [ ] `curl http://localhost:4000/health` → `{"status":"ok"}`
- [ ] `curl http://localhost:4000/api/greeting/hello?name=test` → `{"message":"Hello, test!"}`
- [ ] 브라우저에서 http://localhost:5173 접속 시 데이터 정상
- [ ] (외부 노출 시) `cloudflared` URL 로 동일 응답 확인
- [ ] `.env` 가 git 에 커밋되지 않았는지 확인

### 평가 종료 후

```bash
docker compose down -v          # MySQL 컨테이너 + volume 삭제 (완전 정리)
```
