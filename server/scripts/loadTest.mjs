/**
 * 부하 테스트 — POST /api/recommendations 동시성 측정 (의존성 0, Node 18+ global fetch).
 *
 *  목적: Render 서버 + TiDB 가 동시 N건 조회를 어디까지 버티는지 — 지연 분포·실패율 관찰.
 *
 *  ⚠️ 주의
 *   · /api/recommendations 는 ODsay 안 씀(Haversine 랭킹) → ODsay 쿼터 소모 0. 단,
 *     **TiDB Serverless 무료 RU 를 빠르게 깎는다** — 큰 부하는 월 RU 예산 소진 위험. 짧게·점진적으로.
 *   · 서버-서버 호출이라 CORS 무관(Origin 없음). 브라우저 사용자와 달리 CORS_ORIGIN 영향 안 받음.
 *   · Render free 는 15분 유휴 후 spin-down → 첫 요청 콜드스타트. --warmup 으로 먼저 깨움.
 *
 *  실행:
 *   node server/scripts/loadTest.mjs --url https://api.naodisalm.kr --concurrency 30 --total 300
 *   node server/scripts/loadTest.mjs --concurrency 10 --total 50            # 점진 램프 시작점
 *   node server/scripts/loadTest.mjs --endpoint /health --concurrency 50 --total 500  # 가벼운 헬스만
 */

// --key=value 와 --key value(공백) 둘 다 지원
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--')) { args[key] = nxt; i++; }
      else args[key] = true;
    }
  }
}

const BASE = String(args.url ?? 'https://api.naodisalm.kr').replace(/\/$/, '');
const ENDPOINT = String(args.endpoint ?? '/api/recommendations');
const CONCURRENCY = Number(args.concurrency ?? 20);
const TOTAL = Number(args.total ?? 200);
const WARMUP = args.warmup !== 'false';
const TIMEOUT_MS = Number(args.timeout ?? 30000);

// 현실적인 직장 풀 — 캐시 다양성 + 수도권 분산
const WORKPLACES = [
  { lat: 37.4979, lng: 127.0276, label: '강남역' },
  { lat: 37.3947, lng: 127.1112, label: '판교' },
  { lat: 37.5133, lng: 127.1, label: '잠실' },
  { lat: 37.5219, lng: 126.9245, label: '여의도' },
  { lat: 37.5717, lng: 126.9764, label: '광화문' },
];
const DEAL_TYPES = ['JEONSE', 'MONTHLY', 'SALE'];

function buildBody(i) {
  const wp = WORKPLACES[i % WORKPLACES.length];
  return {
    workplace: wp,
    weights: { commute: 35, affordability: 30, safety: 20, life: 15 },
    patience: 45,
    dealType: DEAL_TYPES[i % DEAL_TYPES.length],
  };
}

async function oneRequest(i) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const isPost = ENDPOINT.startsWith('/api/recommendations');
    const res = await fetch(BASE + ENDPOINT, {
      method: isPost ? 'POST' : 'GET',
      headers: isPost ? { 'content-type': 'application/json' } : undefined,
      body: isPost ? JSON.stringify(buildBody(i)) : undefined,
      signal: ctrl.signal,
    });
    const ms = performance.now() - started;
    // 본문 소비(커넥션 정리)
    await res.text();
    return { ms, status: res.status, ok: res.ok };
  } catch (e) {
    const ms = performance.now() - started;
    return { ms, status: 0, ok: false, err: e.name === 'AbortError' ? 'timeout' : e.code || e.message };
  } finally {
    clearTimeout(t);
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function run() {
  console.log(`\n부하 테스트 → ${BASE}${ENDPOINT}`);
  console.log(`  동시성 ${CONCURRENCY} · 총 ${TOTAL}건 · 타임아웃 ${TIMEOUT_MS}ms\n`);

  if (WARMUP) {
    process.stdout.write('워밍업(콜드스타트 깨우기)… ');
    const w = await oneRequest(0);
    console.log(`${w.status} ${Math.round(w.ms)}ms\n`);
  }

  const results = [];
  let next = 0;
  const wallStart = performance.now();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= TOTAL) return;
      results.push(await oneRequest(i));
      if (results.length % Math.max(1, Math.floor(TOTAL / 10)) === 0) {
        process.stdout.write(`  ${results.length}/${TOTAL}\r`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const wallMs = performance.now() - wallStart;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const ok = results.filter((r) => r.ok).length;
  const byStatus = {};
  const byErr = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.err) byErr[r.err] = (byErr[r.err] ?? 0) + 1;
  }

  console.log('\n\n=== 결과 ===');
  console.log(`총 ${results.length} · 성공 ${ok} (${((ok / results.length) * 100).toFixed(1)}%) · 벽시계 ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`처리량 ≈ ${(results.length / (wallMs / 1000)).toFixed(1)} req/s`);
  console.log(`지연(ms): min ${Math.round(lat[0])} · p50 ${Math.round(pct(lat, 50))} · p90 ${Math.round(pct(lat, 90))} · p95 ${Math.round(pct(lat, 95))} · p99 ${Math.round(pct(lat, 99))} · max ${Math.round(lat[lat.length - 1])}`);
  console.log('상태코드:', JSON.stringify(byStatus));
  if (Object.keys(byErr).length) console.log('에러:', JSON.stringify(byErr));
  console.log('');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
