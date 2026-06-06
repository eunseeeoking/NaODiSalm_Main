/**
 * 단지 실거래 내역 — GET /api/complexes/:complexId/trades?limit=100
 *
 *  ▷ t_apt_trade 원본을 최근순으로 반환 (Depth 3 "실제 거래 내역" 모달용).
 *  ▷ 모델 예측이 아닌 ground-truth 데이터 — 사용자가 직접 보고 판단하도록
 *    노출(선택 도우미 컨셉: 판단 대행 ❌). 면적·층 포함 → 가격 편차를 스스로 이해.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../services/db';

export const complexesRouter = Router();

interface TradeDto {
  ym: string; // "2026-05"
  dealDate: string; // "2026-05-12"
  areaM2: number;
  floor: number | null;
  priceManwon: number;
  pricePerM2: number; // 만원/㎡
}

complexesRouter.get('/:complexId/trades', async (req: Request, res: Response) => {
  const complexId = Number(req.params.complexId);
  if (!Number.isInteger(complexId) || complexId <= 0) {
    return res.status(400).json({ error: 'complexId must be a positive integer' });
  }
  // 최근 N건 (기본 100, 상한 200) — 참고자료 컨셉상 전체 덤프는 지양.
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  try {
    const complex = await prisma.aptComplex.findUnique({
      where: { id: complexId },
      select: { id: true, name: true },
    });
    if (!complex) {
      return res.status(404).json({ error: 'Complex not found', complexId });
    }

    const rows = await prisma.aptTrade.findMany({
      where: { complexId },
      orderBy: { dealDate: 'desc' },
      take: limit,
      select: { dealDate: true, areaM2: true, floor: true, priceManwon: true },
    });

    const trades: TradeDto[] = rows.map((r) => {
      const d = r.dealDate;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return {
        ym: `${y}-${m}`,
        dealDate: `${y}-${m}-${day}`,
        areaM2: r.areaM2,
        floor: r.floor,
        priceManwon: r.priceManwon,
        pricePerM2: r.areaM2 > 0 ? Math.round(r.priceManwon / r.areaM2) : 0,
      };
    });

    res.json({ complexId, name: complex.name, count: trades.length, trades });
  } catch (err) {
    console.error('[complexes/trades] error', err);
    res.status(500).json({ error: 'internal error' });
  }
});
