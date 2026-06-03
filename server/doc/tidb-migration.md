# 로컬 MySQL → TiDB Cloud Serverless 데이터 갱신 가이드

> 작성: 2026-06-04 · 대상: `molit_contest` DB 전체(실거래·시세·시드 테이블)
> 도구: `server/scripts/exportToTidb.ts` (`npm run export:tidb`) · 스키마는 Prisma
> 배경: HeidiSQL "SQL 파일 export → import"(단일 커넥션·작은 배치·TLS 왕복)가 느려, 배치 multi-row
>       INSERT + 병렬 커넥션 방식으로 대체. 763만 행 25테이블 기준 **~3.5분**(기존 대비 대폭 단축).

---

## 0. 한 줄 요약

```bash
cd server
# (1) 스키마 동기화 — 테이블 구조가 바뀌었을 때만
DATABASE_URL="$TIDB_DATABASE_URL" npx prisma db push --skip-generate --accept-data-loss
# (2) 데이터 새로 적재 (대상 비우고 복사)
npm run export:tidb -- --truncate
# (3) 무결성 — 양쪽 COUNT(*) 대조 (아래 §4 스니펫)
```

---

## 1. 사전 준비 (1회)

`server/.env` 에 TiDB 접속정보 추가 (비밀번호 직접 입력):

```
TIDB_DATABASE_URL="mysql://<clusterId>.root:<password>@gateway01.<region>.prod.aws.tidbcloud.com:4000/molit_contest?sslaccept=strict"
```

- **TLS 필수**(Serverless). export 스크립트는 자동 적용. `?sslaccept=strict` 는 `prisma db push` 단계용.
- 비밀번호 특수문자는 **URL 인코딩**(`@`→`%40`, `#`→`%23` 등).
- 유저명은 `<clusterId>.root` 형태.
- TiDB 측에 `molit_contest` DB 가 미리 있어야 함(없으면 콘솔에서 `CREATE DATABASE molit_contest`).
- `.env` 는 gitignore 처리되어 비밀이 커밋되지 않음(확인 완료).

---

## 2. 스키마 동기화 (구조 변경 시에만)

테이블/컬럼이 바뀌었을 때만 실행. **데이터만 갱신**할 거면 건너뛴다.

```bash
cd server
DATABASE_URL="$TIDB_DATABASE_URL" npx prisma db push --skip-generate --accept-data-loss
```

- `DATABASE_URL` 을 그 명령에만 TiDB 로 오버라이드 → `.env` 의 로컬 URL·실행 중 dev 서버에 영향 없음.
  (bash 에서 `TIDB_URL=$(node -e "require('dotenv/config');process.stdout.write(process.env.TIDB_DATABASE_URL||'')")` 로
  값을 받아 `DATABASE_URL="$TIDB_URL" ...` 로 넘기면 비밀이 노출되지 않음.)
- `--skip-generate`: Prisma Client 재생성 생략(로컬 generate 와 무관, EPERM 회피).
- `--accept-data-loss`: TiDB 쪽 스키마를 Prisma 정의에 맞춤(예: 과거 `raw_payload` 컬럼 드롭). 데이터는 어차피
  §3 에서 새로 적재하므로 안전. ⚠️ Prisma 정의에 없는 TiDB 컬럼이 제거될 수 있으니 의도와 일치하는지 확인.

---

## 3. 데이터 적재 (`export:tidb`)

```bash
cd server
npm run export:tidb -- --truncate                       # 전 테이블: 비우고 새로 복사 (권장)
npm run export:tidb                                      # 비우지 않고 INSERT (빈 테이블 전제)
npm run export:tidb -- --tables=t_apt_trade,t_apt_rent  # 특정 테이블만
npm run export:tidb -- --exclude=t_user,t_user_token    # 제외
npm run export:tidb -- --truncate --batch=3000 --concurrency=6   # 더 빠르게
```

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--truncate` | off | 대상 테이블을 먼저 `TRUNCATE` 후 복사(재실행 안전). 없으면 중복 INSERT 위험 |
| `--tables=a,b` | 전체 | 복사할 테이블 화이트리스트 |
| `--exclude=a,b` | 없음 | 제외 테이블 |
| `--batch=N` | 1500 | 한 INSERT 당 행 수(multi-row). TiDB 트랜잭션 한계 안에서 키울수록 빠름 |
| `--concurrency=N` | 4 | 동시 INSERT 커넥션 수. Serverless 커넥션 한도 내에서 |

동작 요점:
- 소스 = `DATABASE_URL`(로컬), 대상 = `TIDB_DATABASE_URL`. 소스는 **읽기 전용**.
- 행수 오름차순으로 처리(작은 테이블부터). 소스는 **스트리밍**(대용량 메모리 안전).
- 대상 세션 `FOREIGN_KEY_CHECKS=0`·`unique_checks=0`(속도).
- **DATETIME/DATE 는 문자열로 읽어** 타임존 변환 없이 그대로 이관(`dateStrings:true`).
- JSON 컬럼은 재직렬화. NULL/Buffer/숫자/문자열은 그대로.

---

## 4. 무결성 검증 (양쪽 COUNT 대조)

```bash
cd server && node -e "
require('dotenv/config');
const mysql=require('mysql2/promise');
const mk=(u,t)=>{const x=new URL(u);return{host:x.hostname,port:+(x.port||3306),user:decodeURIComponent(x.username),password:decodeURIComponent(x.password),database:x.pathname.slice(1),...(t?{ssl:{minVersion:'TLSv1.2',rejectUnauthorized:true}}:{})};};
(async()=>{const s=await mysql.createConnection(mk(process.env.DATABASE_URL,0)),d=await mysql.createConnection(mk(process.env.TIDB_DATABASE_URL,1));
const [ts]=await s.query(\"SELECT table_name n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'\");
let bad=0,st=0,dt=0;for(const{n}of ts){const[[a]]=await s.query('SELECT COUNT(*) c FROM \`'+n+'\`');let dc;try{const[[b]]=await d.query('SELECT COUNT(*) c FROM \`'+n+'\`');dc=+b.c}catch(e){dc='MISSING'}st+=+a.c;if(typeof dc==='number')dt+=dc;if(dc!==+a.c){bad++;console.log('✗ '+n+' local='+a.c+' tidb='+dc)}}
console.log('불일치 '+bad+' / 합계 local='+st.toLocaleString()+' tidb='+dt.toLocaleString()+' '+(st===dt?'✓':'⚠'));await s.end();await d.end();})();
"
```

→ "불일치 0 / 합계 ... ✓" 면 완전 일치.

---

## 5. 언제 다시 돌리나

- **실거래 재적재**(`ingest:apt:bulk`·`ingest:realty:bulk` 등) 후 → §3 `--truncate` 재실행.
- **시드 갱신**(safety/life/transit/**price-summary**) 후 → 해당 테이블만 `--tables=` 로 갱신 가능.
- **스키마 변경** 후 → §2 먼저, 그다음 §3.
- ⚠️ **`t_dong_price_summary`(KI-21)** 는 cutoff(최신 거래일)·환산율(RATE) 의존 → 실거래 갱신 시
  `npm run seed:price-summary` 로 **로컬에서 재집계한 뒤** TiDB 로 복사해야 정합.

---

## 6. Serverless 주의사항

- **TLS 강제** · 유저명 prefix(`<clusterId>.root`).
- **무료 티어 스토리지/RU 한도**: 763만 행이면 대략 수백 MB~1GB+. 초기 벌크는 RU 소모 큼 → 한도 확인.
- **Lightning physical 모드 불가**(관리형). 대량을 더 밀어붙이려면 TiDB Cloud Console **Import**(S3/로컬 CSV) 대안.
- AUTO_INCREMENT 값 gap 은 TiDB 정상 동작. FK 제약은 TiDB 6.6+ 만 강제(본 스키마는 앱 레벨 관계).

---

## 7. 참고

- 도구: [`server/scripts/exportToTidb.ts`](../scripts/exportToTidb.ts)
- 스키마: [`server/prisma/schema.prisma`](../prisma/schema.prisma)
- KI-21 사전집계: [`server/scripts/seedDongPriceSummary.ts`](../scripts/seedDongPriceSummary.ts) · `docs/known-issues.md` KI-21
