# prod 부하 테스트 리포트 — Render 동시성 한계 + 병목 3종 규명

> 작성: 2026-06-06 · 대상: `https://api.naodisalm.kr` `POST /api/recommendations`
> 도구: [`server/scripts/loadTest.mjs`](../../scripts/loadTest.mjs) (의존성 0, Node global fetch)
> 목적: "발표 때 한번에 20~50명 동시 조회"를 prod가 버티는지 + 못 버티면 무엇이 병목인지.

---

## 0. TL;DR

- 병목이 **3겹**으로 순차 드러남: ① DB 크로스리전 지연 → ② Render CPU(처리량) → ③ Prisma 커넥션 풀.
- 셋 다 잡으니 **Standard + 커넥션풀20에서 동시 50까지 100% 성공**.
- **무료 티어(0.1 CPU)는 어떤 설정으로도 동시 20에서 붕괴** → 발표엔 Standard 필수.
- **최종 prod 구성**: TiDB 싱가포르(동리전) + `connection_limit=20`(영구) + 발표 윈도우만 Render Standard.

---

## 1. 방법

- 시나리오: "한번에 N명 동시 클릭" = `--concurrency N --total N` (N개를 동시에 발사, 30s 클라 타임아웃).
- 페이로드: 수도권 직장 5종(강남·판교·잠실·여의도·광화문) × dealType 3종 순환, 유효한 가중치/인내심.
- `/api/recommendations`는 ODsay 미사용(Haversine 랭킹) → **ODsay 쿼터 소모 0**. DB는 TiDB.
- 측정: 성공률, 성공분 지연 p50, 실패 모드(timeout/500/503).

---

## 2. 결과 — 구성별 (성공률 / 성공분 p50)

| 동시 N | ① free·도쿄 | ② free·싱가포르 | ③ Standard·풀기본 | ④ **Standard·풀20** | ⑤ free·풀20 |
|---|---|---|---|---|---|
| 2 | 100% / 3.95s | 100% / 2.97s | 90% / 1.3s | **100% / 1.5s** | 100% / 1.4s* |
| 10 | 100% / 13.5s | 100% / 14.0s | 60% / 6.3s | **100% / 5.4s** | 100% / 24.0s |
| 20 | **0%** (timeout) | 100% / 27.9s | 80% / 8.2s | **100% / 11.3s** | **0%** (timeout) |
| 30 | **0%** | **0%** (timeout) | 83% / 11.9s | **100% / 15.5s** | **0%** (503×30) |
| 50 | **0%** (t43+500×7) | **0%** (t19+500×31) | 90% / 20.4s | **100% / 26.0s** | **0%** (503×50) |
| 처리량 | ~0.7 req/s | ~0.7 req/s | ~1.9 req/s | **~1.9 req/s** | ~0.4 req/s |

\* ⑤ conc 2는 다운그레이드 전환 직후 warm 인스턴스라 낙관 편향 가능. conc 10(24s)부터가 진짜 free 0.1 CPU 거동.

---

## 3. 병목 분석 (드러난 순서)

### ① DB 크로스리전 — Render(싱가포르) ↔ TiDB(도쿄 ap-northeast-1)
- 추천 1건이 TiDB에 다수 순차 왕복 → 매 왕복 ~70~100ms × 쿼리 수 = **요청당 ~4초 바닥**(로컬 동일 쿼리는 ~1초).
- **조치**: TiDB를 **싱가포르(ap-southeast-1)** 신규 클러스터로 이전(스키마 push + `export:tidb`, 7.63M행 무결성 일치).
- **효과**: per-request 3.95s→2.97s(**-25%**), 동시 20이 0%→100%(턱걸이). **단 처리량 천장(0.7 req/s)은 불변** → 리전이 throughput 병목은 아니었음.

### ② Render CPU — free 0.1 CPU → Standard 1 CPU
- 처리량이 동시성과 무관하게 **0.7 req/s에 고정** = 직렬 자원 포화(CPU). free에선 동시 10이 14~24s, 20+는 붕괴.
- **조치**: Render **Standard(1 CPU/2GB)** 업그레이드(초단위 과금, 테스트 비용 ≈ 수십~수백 원).
- **효과**: 처리량 0.7→**1.9 req/s**, per-request 3s→1.3s, 500(OOM) 소멸. 동시 30/50이 0%→83~90%. **단 모든 레벨에서 ~5건 30s 타임아웃 tail 잔존**(바이모달).

### ③ Prisma 커넥션 풀 — 기본값(작음) → connection_limit=20
- 바이모달(빠른 다수 + 멈춘 소수 ~5건)은 CPU 큐잉이 아니라 **커넥션 고갈** 시그니처. [`db.ts`](../../src/services/db.ts)에 `connection_limit` 미설정 → Prisma 기본 풀(≈ CPU×2+1, 1코어면 ~3개)이라 동시 요청이 커넥션 못 잡고 타임아웃.
- **조치**: Render `DATABASE_URL`에 `&connection_limit=20&pool_timeout=20` 추가.
- **효과**: **타임아웃 tail 소멸 → 전 레벨 100% 성공.** 지연 분포가 칼같이 모임(큐잉) = 깔끔한 처리량 한계만 남음.

---

## 4. 최종 상태 (④ Standard + 풀20)

- **동시 50까지 100% 성공.** 지연 = N ÷ 1.9 req/s 큐잉: 동시 30→p50 15.5s, 50→26s(타임아웃 직전).
- 잔여 천장 **~1.9 req/s** = 1 CPU + TiDB 쿼리 지연/수의 복합. 더 올리려면:
  - 추천의 **순차 TiDB 쿼리 수 축소(배치)** 또는 스코어링 CPU 경량화 (코드 최적화, 무료).
  - 또는 인스턴스 수평 확장(추가 비용).
- 발표 현실: 30명이 *같은 1초*에 누르는 게 아니라 10~30s에 걸쳐 들어옴 → 1.9 req/s가 거의 실시간 소화, 체감 ~1.5s. 완전 동시 클릭만 15s tail.

---

## 5. 결론 & prod 구성

| 항목 | 값 |
|---|---|
| TiDB | **싱가포르(ap-southeast-1)** — Render 동리전 |
| Prisma | **`connection_limit=20`** (DATABASE_URL, 영구) |
| Render | 평소 **free**, **발표 윈도우만 Standard**(D-1 업 → 끝나고 다운, 초단위 과금) |
| 도쿄 TiDB | 싱가포르 안정 확인 후 삭제(현재 롤백 카드로 보존) |

**발표 대비 액션**: D-1 Standard 업 → 본 스크립트로 동시 30/50 100% 재확인 → 워밍업(데모 직장 호출) → 발표 → free 다운.

---

## 6. 재현

```bash
# 단일 baseline
node server/scripts/loadTest.mjs --url https://api.naodisalm.kr --concurrency 2 --total 10
# "한번에 N명" 램프
for N in 10 20 30 50; do node server/scripts/loadTest.mjs --concurrency $N --total $N --warmup false; done
```

옵션: `--concurrency` `--total` `--warmup false` `--timeout <ms>` `--endpoint /health`.
주의: `/api/recommendations`는 TiDB RU를 소모 → 큰 부하는 무료 RU 예산 유의. 서버-서버라 CORS 무관.
