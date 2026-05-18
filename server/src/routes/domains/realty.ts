import { Router } from 'express';
import {
  findComplexes,
  findComplexDetail,
} from '../../services/repositories/realtyRepository';

/**
 * 부동산 도메인 라우터 (/api/realty)
 *  - 공개 엔드포인트 (인증 불필요)
 *  - 추후 사용자 즐겨찾기 등은 별도 protected 엔드포인트로 분리
 */
export const realtyRouter = Router();

// GET /api/realty/complexes?sigunguCode=11680&limit=2000
realtyRouter.get('/complexes', async (req, res, next) => {
  try {
    const sigunguCode =
      typeof req.query.sigunguCode === 'string' ? req.query.sigunguCode : undefined;
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const rows = await findComplexes({ sigunguCode, limit });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/realty/complexes/:id
realtyRouter.get('/complexes/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const detail = await findComplexDetail(id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    res.json(detail);
  } catch (e) {
    next(e);
  }
});
