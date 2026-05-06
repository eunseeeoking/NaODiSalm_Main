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
