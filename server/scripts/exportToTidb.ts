/**
 * 로컬 MySQL → TiDB Cloud Serverless 데이터 벌크 복사 (2026-06-04)
 *
 *  ▷ 목적: HeidiSQL "SQL 파일 export → import"(단일 커넥션·작은 배치·TLS 왕복)로 느리던 이관을,
 *    배치 multi-row INSERT + 병렬 커넥션으로 가속. 스키마는 Prisma 가 먼저 생성(아래) → 본 스크립트는 데이터만.
 *
 *  ▷ 사전 준비
 *    1) TiDB 접속정보를 server/.env 에 추가 (비밀번호 직접 입력):
 *         TIDB_DATABASE_URL="mysql://<id>.root:<password>@gateway01.<region>.prod.aws.tidbcloud.com:4000/molit_contest"
 *       (Serverless 는 TLS 필수 — 스크립트가 자동 적용. URL 에 ?sslaccept=strict 등은 있어도 무방.)
 *    2) 스키마 생성(1회): TiDB 로 prisma db push
 *         DATABASE_URL="$TIDB_DATABASE_URL" npx prisma db push --skip-generate
 *
 *  ▷ 실행
 *    cd server
 *    npm run export:tidb                 # 전 테이블 복사
 *    npm run export:tidb -- --truncate   # 대상 테이블 먼저 비우고 복사(재실행 안전)
 *    npm run export:tidb -- --tables=t_apt_trade,t_apt_rent
 *    npm run export:tidb -- --exclude=t_user,t_user_token --batch=2000 --concurrency=6
 *
 *  ▷ 동작/주의
 *    - 소스(SRC)=DATABASE_URL(로컬), 대상(DST)=TIDB_DATABASE_URL.
 *    - DST 세션 FK/unique 체크 off (속도) · DATETIME 은 문자열로 읽어 타임존 변환 없이 그대로 이관.
 *    - 배치 크기는 TiDB 트랜잭션 한계 안(기본 1500행). 빠르면 키워도 됨.
 *    - 스키마는 Prisma 가 만든 빈 테이블 전제. --truncate 없이 재실행하면 중복 INSERT 될 수 있음.
 */
import 'dotenv/config';
import mysql from 'mysql2';
import mysqlp from 'mysql2/promise';

type Args = { truncate: boolean; tables: string[] | null; exclude: string[]; batch: number; concurrency: number };
function parseArgs(): Args {
  const a: Args = { truncate: false, tables: null, exclude: [], batch: 1500, concurrency: 4 };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--truncate') a.truncate = true;
    else if (arg.startsWith('--tables=')) a.tables = arg.slice(9).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--exclude=')) a.exclude = arg.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--batch=')) a.batch = Math.max(100, Number(arg.slice(8)) || 1500);
    else if (arg.startsWith('--concurrency=')) a.concurrency = Math.max(1, Number(arg.slice(14)) || 4);
  }
  return a;
}

function toConfig(url: string, tls: boolean): mysql.ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    dateStrings: true, // DATETIME/DATE/TIMESTAMP 를 문자열로 → 타임존 변환 없이 그대로 이관
    ...(tls ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
  };
}

const fmt = (n: number) => n.toLocaleString();

async function main() {
  const args = parseArgs();
  const SRC_URL = process.env.DATABASE_URL;
  const DST_URL = process.env.TIDB_DATABASE_URL;
  if (!SRC_URL) throw new Error('DATABASE_URL(로컬 소스) 미설정');
  if (!DST_URL) throw new Error('TIDB_DATABASE_URL(대상) 미설정 — server/.env 에 추가하세요');

  const srcCfg = toConfig(SRC_URL, false);
  const dstCfg = toConfig(DST_URL, true);
  console.log(`[export:tidb] SRC ${srcCfg.host}:${srcCfg.port}/${srcCfg.database}  →  DST ${dstCfg.host}:${dstCfg.port}/${dstCfg.database}`);
  console.log(`  batch=${args.batch} concurrency=${args.concurrency} truncate=${args.truncate}`);

  // 메타데이터 조회용 단일 커넥션
  const meta = await mysqlp.createConnection({ ...srcCfg });

  // 대상 풀 (병렬 INSERT). FK/unique 체크 off 로 속도↑.
  const dstPool = mysqlp.createPool({ ...dstCfg, connectionLimit: args.concurrency + 1, waitForConnections: true, maxIdle: args.concurrency + 1 });
  dstPool.on('connection', (c) => {
    c.query('SET FOREIGN_KEY_CHECKS=0');
    c.query('SET unique_checks=0');
  });

  // 테이블 목록 (BASE TABLE 만)
  const [tblRows] = await meta.query<any[]>(
    `SELECT table_name AS name, table_rows AS approx FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_rows ASC`,
    [srcCfg.database],
  );
  let tables = (tblRows as { name: string; approx: number }[]).map((r) => ({ name: r.name, approx: Number(r.approx) || 0 }));
  if (args.tables) tables = tables.filter((t) => args.tables!.includes(t.name));
  if (args.exclude.length) tables = tables.filter((t) => !args.exclude.includes(t.name));
  console.log(`  대상 테이블 ${tables.length}개 (총 추정 ${fmt(tables.reduce((s, t) => s + t.approx, 0))}행)\n`);

  const t0 = Date.now();
  let grandTotal = 0;
  for (const tbl of tables) {
    const copied = await copyTable(srcCfg, dstPool, meta, tbl.name, tbl.approx, args);
    grandTotal += copied;
  }

  await meta.end();
  await dstPool.end();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[export:tidb] 완료 — ${fmt(grandTotal)}행 / ${tables.length}테이블 / ${secs}s`);
}

/** JSON 컬럼은 객체로 파싱돼 오므로 재직렬화. 나머지(string/number/Date-string/Buffer/null)는 그대로. */
function normalizeRow(row: Record<string, unknown>, cols: string[], jsonCols: Set<string>): unknown[] {
  return cols.map((c) => {
    const v = row[c];
    if (v != null && jsonCols.has(c) && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

async function copyTable(
  srcCfg: mysql.ConnectionOptions,
  dstPool: mysqlp.Pool,
  meta: mysqlp.Connection,
  table: string,
  approx: number,
  args: Args,
): Promise<number> {
  // 컬럼 순서 + JSON 컬럼 식별
  const [colRows] = await meta.query<any[]>(
    `SELECT column_name AS name, data_type AS type FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [srcCfg.database, table],
  );
  const cols = (colRows as { name: string; type: string }[]).map((r) => r.name);
  const jsonCols = new Set((colRows as { name: string; type: string }[]).filter((r) => r.type === 'json').map((r) => r.name));
  if (cols.length === 0) {
    console.log(`  - ${table}: 컬럼 없음, skip`);
    return 0;
  }

  if (args.truncate) await dstPool.query(`TRUNCATE TABLE \`${table}\``);

  const colList = cols.map((c) => `\`${c}\``).join(',');
  const insertSql = `INSERT INTO \`${table}\` (${colList}) VALUES ?`;

  // 스트리밍 소스 커넥션 (대용량 메모리 안전)
  const srcConn = mysql.createConnection({ ...srcCfg });

  return new Promise<number>((resolve, reject) => {
    let batch: unknown[][] = [];
    let inFlight = 0;
    let done = 0;
    let ended = false;
    const startedAt = Date.now();

    const stream = srcConn.query(`SELECT * FROM \`${table}\``).stream();

    const tryFinish = () => {
      if (ended && inFlight === 0 && batch.length === 0) {
        srcConn.end();
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`  ✓ ${table}: ${fmt(done)}행 / ${secs}s`);
        resolve(done);
      }
    };

    const flush = (rows: unknown[][]) => {
      inFlight++;
      if (inFlight >= args.concurrency) stream.pause();
      dstPool
        .query(insertSql, [rows])
        .then(() => {
          done += rows.length;
          if (done % (args.batch * 20) < args.batch && approx > 0) {
            const pct = Math.min(100, Math.round((done / approx) * 100));
            process.stdout.write(`    ${table}: ${fmt(done)}/~${fmt(approx)} (${pct}%)\r`);
          }
        })
        .catch((e) => { srcConn.end(); reject(new Error(`${table} INSERT 실패: ${e.message}`)); })
        .finally(() => {
          inFlight--;
          if (stream.isPaused()) stream.resume();
          tryFinish();
        });
    };

    stream.on('data', (row: Record<string, unknown>) => {
      batch.push(normalizeRow(row, cols, jsonCols));
      if (batch.length >= args.batch) {
        const b = batch;
        batch = [];
        flush(b);
      }
    });
    stream.on('error', (e) => { srcConn.end(); reject(new Error(`${table} 읽기 실패: ${e.message}`)); });
    stream.on('end', () => {
      ended = true;
      if (batch.length > 0) {
        const b = batch;
        batch = [];
        flush(b);
      } else {
        tryFinish();
      }
    });
  });
}

main().catch((e) => {
  console.error('\n[export:tidb] 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
