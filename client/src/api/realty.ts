import { apiFetch } from './client';

export interface ComplexMarker {
  id: number;
  aptSeq: string | null;
  name: string;
  sigunguCode: string;
  legalDong: string;
  builtYear: number | null;
  lat: number;
  lng: number;
  lastTradeDate: string | null;
  lastTradePriceManwon: number | null;
  tradeCount12m: number;
  rentCount12m: number;
}

export interface TradeRow {
  dealDate: string;
  priceManwon: number;
  areaM2: number;
  floor: number | null;
  builtYear: number | null;
}

export interface RentRow {
  contractDate: string;
  depositManwon: number;
  monthlyManwon: number;
  contractType: 'JEONSE' | 'WOLSE';
  areaM2: number;
  floor: number | null;
}

export interface ComplexDetail {
  complex: {
    id: number;
    aptSeq: string | null;
    name: string;
    sigunguCode: string;
    legalDong: string;
    jibun: string | null;
    roadAddr: string | null;
    builtYear: number | null;
    lat: number | null;
    lng: number | null;
  };
  recentTrades: TradeRow[];
  recentRents: RentRow[];
}

export function fetchComplexes(opts: {
  sigunguCode?: string;
  limit?: number;
} = {}): Promise<ComplexMarker[]> {
  return apiFetch<ComplexMarker[]>('/api/realty/complexes', { query: opts });
}

export function fetchComplexDetail(id: number): Promise<ComplexDetail> {
  return apiFetch<ComplexDetail>(`/api/realty/complexes/${id}`);
}
