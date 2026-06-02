/**
 * raw_payload 콜드 아카이브 — 컬럼 DROP 전 원본 JSON 을 파일로 백업 (KI-21 후속 / 용량 최적화)
 *
 *  ▷ 배경
 *    trade·rent 7개 테이블의 `raw_payload`(국토부 원본 JSON)는 **서빙에서 안 읽힘**(ingest 만 씀).
 *    DB 최대 용량 비용이라 DROP 예정이나, 재파싱·백테스트 대비 **파일로 먼저 보관**(비용 ≈ 0).
 *
 *  ▷ 동작
 *    각 테이블을 id 커서로 배치(5000) 스트리밍 → `server/archive/raw_payload_<table>.jsonl.gz`
 *    (한 줄 = {"id":N,"raw_payload":<원본 JSON>}). raw_payload NULL 행은 건너뜀.
 *
 *  ▷ 실행 (DROP 전에 1회)
 *    cd server
 *    npm run archive:raw
 *    → 완료 후 schema 에서 rawPayload 제거 + `npx prisma db push` 로 컬럼 DROP.
 *
 *  ▷ 복원(필요 시): gunzip 후 JSONL 파싱하여 재적재 또는 재파싱 입력으로 사용.
 */
import 'dotenv/config';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { resolve } from 'node:path';
import { prisma } from '../src/services/db';

// raw_payload 보유 테이블 (schema 기준). 고정 상수 — SQL 인젝션 무관.
const TABLES = [
  't_apt_trade',
  't_apt_rent',
  't_offi_trade',
  't_offi_rent',
  't_villa_trade',
  't_villa_rent',
  't_sh_rent',
] as const;

const BATCH = 5000;
const OUT_DIR = resolve(__dirname, '../archive');

/** 백프레셔 안전 write (drain 대기). */
function write(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  return new Promise((res) => {
    if (stream.write(chunk)) res();
    else stream.once('drain', () => res());
  });
}

async function archiveTable(table: string): Promise<number> {
  const gz = createGzip();
  const out = createWriteStream(resolve(OUT_DIR, `raw_payload_${table}.jsonl.gz`));
  gz.pipe(out);

  let lastId = 0;
  let total = 0;
  for (;;) {
    // 고정 테이블명(상수) + id 파라미터 바인딩 → 안전
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; raw_payload: unknown }>>(
      `SELECT id, raw_payload FROM ${table} WHERE id > ? AND raw_payload IS NOT NULL ORDER BY id LIMIT ${BATCH}`,
      lastId,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      await write(gz, JSON.stringify({ id: Number(r.id), raw_payload: r.raw_payload }) + '\n');
    }
    total += rows.length;
    lastId = Number(rows[rows.length - 1].id);
    process.stdout.write(`\r  ${table}: ${total.toLocaleString()}건...`);
  }

  await new Promise<void>((res, rej) => {
    gz.end();
    out.on('finish', () => res());
    out.on('error', rej);
  });
  return total;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[archive:raw] 시작 → ${OUT_DIR}`);
  let grand = 0;
  for (const t of TABLES) {
    const n = await archiveTable(t);
    grand += n;
    console.log(`\n  ✓ ${t}: ${n.toLocaleString()}건 → archive/raw_payload_${t}.jsonl.gz`);
  }
  console.log(`\n[archive:raw] 완료 — 총 ${grand.toLocaleString()}건 백업.`);
  console.log('  다음: schema 의 rawPayload 제거(코드 반영됨) → npx prisma db push → npx prisma generate 로 컬럼 DROP.');
}

main()
  .catch((e) => {
    console.error('[archive:raw] 오류:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
