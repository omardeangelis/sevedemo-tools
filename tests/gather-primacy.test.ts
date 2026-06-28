import { describe, expect, it } from 'vitest';
import type { RawCandidate, Strategy } from '../src/strategies/types.js';
import { config } from '../src/config.js';

const PRIMARY_ID = config.primaryStrategyId; // 'influencer-post-respondents'
const POOL = 100;

/** Strategia finta che registra i `limit` richiesti e rende `min(limit, supply)` univoci. */
function fake(id: string, supply: number) {
  const calls: number[] = [];
  const strat: Strategy = {
    id,
    description: '',
    requiresCookie: false,
    bucketHint: 'misto',
    async source(limit: number): Promise<RawCandidate[]> {
      calls.push(limit);
      const n = Math.min(limit, supply);
      return Array.from({ length: n }, (_, i) => ({
        linkedinUrl: `https://www.linkedin.com/in/${id}-${i}`,
        raw: {},
      }));
    },
  };
  return { strat, calls };
}

function throwingFake(id: string): Strategy {
  return {
    id,
    description: '',
    requiresCookie: false,
    bucketHint: 'misto',
    async source(): Promise<RawCandidate[]> {
      throw new Error(`boom ${id}`);
    },
  };
}

const countFor = (candidates: Array<{ strategyId: string }>, id: string) =>
  candidates.filter((c) => c.strategyId === id).length;

describe('gather (T9): primazia + budget dominante + riflusso', () => {
  it('(a) primaria rende 0 → totale = min(Σ disponibili, POOL); le altre riempiono tutto', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 0);
    const a = fake('alt-a', 1000);
    const b = fake('alt-b', 1000);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(candidates.length).toBe(POOL);
    expect(countFor(candidates, PRIMARY_ID)).toBe(0);
  });

  it('(b) primaria abbondante → riceve primaryCap (quota dominante) ed è iterata per prima', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 1000);
    const a = fake('alt-a', 1000);
    const b = fake('alt-b', 1000);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    const cap = Math.round(POOL * config.primaryWeight);
    expect(primary.calls[0]).toBe(cap); // chiesta per prima, con la sua quota cap
    expect(countFor(candidates, PRIMARY_ID)).toBe(cap);
    expect(candidates.length).toBe(POOL);
  });

  it('(c) primaria parziale (30) → le altre si dividono POOL−30 con carry-over', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 30);
    const a = fake('alt-a', 1000);
    const b = fake('alt-b', 1000);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(countFor(candidates, PRIMARY_ID)).toBe(30);
    expect(candidates.length).toBe(POOL);
  });

  it('(d) supply mista (primaria 0 + una non-primaria limitata) → totale = min(Σ disponibili, POOL)', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 0);
    const a = fake('alt-a', 10); // limitata
    const b = fake('alt-b', 50); // limitata: Σ = 0+10+50 = 60 < POOL

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(candidates.length).toBe(60); // niente over/under-fill: off-by-one blindato
  });

  it('(e) una strategia che lancia → errorByStrategy la contiene e il run prosegue', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 0);
    const boom = throwingFake('alt-boom');
    const b = fake('alt-b', 1000);

    const { candidates, errorByStrategy } = await gather([primary.strat, boom, b.strat], POOL);
    expect(errorByStrategy.get('alt-boom')).toMatch(/boom/);
    expect(candidates.length).toBe(POOL); // alt-b copre tutto il residuo
  });

  it('(f) primaria sovrabbondante OLTRE il cap + altre supply-thin → reclaim: totale = min(Σ disponibili, POOL)', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    // primaria ha 80 (oltre il cap 50), le altre solo 5 ciascuna: Σ = 90.
    // Senza reclaim la primaria resta a 50 e il totale è 60 (under-fill, BUG).
    // Con reclaim la primaria riempie il residuo: totale = 90.
    const primary = fake(PRIMARY_ID, 80);
    const a = fake('alt-a', 5);
    const b = fake('alt-b', 5);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(candidates.length).toBe(90);
    // la primaria recupera il budget non usato dalle altre (oltre il suo cap iniziale)
    expect(countFor(candidates, PRIMARY_ID)).toBe(80);
  });

  it('(g) reclaim da una NON-primaria supply-rich quando la primaria è esaurita', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 5);
    const a = fake('alt-a', 80); // ricca
    const b = fake('alt-b', 5);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(candidates.length).toBe(90); // min(Σ=90, POOL=100)
    expect(countFor(candidates, 'alt-a')).toBe(80);
  });

  it('NON fa reclaim quando la fase 2 riempie il pool (nessuna seconda chiamata)', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 1000);
    const a = fake('alt-a', 1000);
    const b = fake('alt-b', 1000);

    const { candidates } = await gather([primary.strat, a.strat, b.strat], POOL);
    expect(candidates.length).toBe(POOL);
    // pool pieno in fase 2 → nessun reclaim: ogni strategia chiamata una sola volta
    expect(primary.calls.length).toBe(1);
    expect(a.calls.length).toBe(1);
    expect(b.calls.length).toBe(1);
  });

  it('strategia singola (runStrategy) → riceve l\'intero limit anche se è la primaria', async () => {
    const { gather } = await import('../src/pipeline/run.js');
    const primary = fake(PRIMARY_ID, 1000);
    const { candidates } = await gather([primary.strat], POOL);
    expect(primary.calls[0]).toBe(POOL); // nessuno split: una sola strategia prende tutto
    expect(candidates.length).toBe(POOL);
  });
});
