import type { Company } from './companies.js';
import { db, hasTable, nowIso } from './index.js';

/*
 * Unione di aziende (SPEC apollo-lookalike, "Regole di unione"). La superstite la sceglie il
 * chiamante: nei job `upsertCompany` (chi ha l'URL LinkedIn, altrimenti id minore), nell'unione
 * esplicita l'azienda indicata dall'utente (SPEC B5). Qui nessuna euristica sul superstite.
 */

function filled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Il superstite tiene i propri valori non vuoti e prende dall'assorbita quelli che mancano. */
function fill(keep: string | null, drop: string | null): string | null {
  return filled(keep) ? keep : filled(drop) ? drop : null;
}

/** Note concatenate (una sola volta se identiche). */
function joinNotes(keep: string | null, drop: string | null): string | null {
  if (!filled(keep)) return filled(drop) ? drop : null;
  if (!filled(drop) || drop.trim() === keep.trim()) return keep;
  return `${keep}\n\n${drop}`;
}

/**
 * Blocco Apollo (`apollo_org_id`, `apollo_json`, `apollo_enriched_at`) che resta: i dati più recenti
 * vincono; un'organizzazione trovata vince comunque su un tentativo senza esito (org nullo: "non
 * trovata" o "chiavi in conflitto"), così un dato già pagato non si perde; a parità il superstite.
 */
function apolloSource(keep: Company, drop: Company): Company {
  const hasApollo = (c: Company) => c.apollo_org_id !== null || c.apollo_json !== null || c.apollo_enriched_at !== null;
  if (!hasApollo(drop)) return keep;
  if (!hasApollo(keep)) return drop;
  const keepFound = keep.apollo_org_id !== null;
  const dropFound = drop.apollo_org_id !== null;
  if (keepFound !== dropFound) return dropFound ? drop : keep;
  return (drop.apollo_enriched_at ?? '') > (keep.apollo_enriched_at ?? '') ? drop : keep;
}

/**
 * Unisce l'azienda `dropId` in `keepId` e la cancella, in una transazione. Relazioni passate al
 * superstite: riferimenti ICP (stesso ICP su entrambe → resta quello del superstite), candidature
 * (se la tabella esiste: la referenza vince sulla candidatura dello stesso ICP; tra due candidature
 * vince lo stato deciso su `proposta`, a parità quella del superstite), prospect collegati e fonti
 * (stessa `(prospect, kind)` su entrambe → resta la più recente per `captured_at`, a parità quella
 * del superstite). Campi: COALESCE verso il superstite (chiavi comprese), note concatenate, blocco
 * Apollo secondo `apolloSource`, `created_at` il più vecchio. L'assorbita si cancella prima di
 * scrivere le chiavi sul superstite (nessuna violazione di UNIQUE). Ritorna il superstite.
 */
export function mergeCompanies(keepId: number, dropId: number): Company {
  return db.transaction(() => {
    const select = db.prepare('SELECT * FROM companies WHERE id = ?');
    const keep = select.get(keepId) as Company | undefined;
    const drop = select.get(dropId) as Company | undefined;
    if (!keep) throw new Error(`Azienda inesistente: ${keepId}`);
    if (keepId === dropId) return keep;
    if (!drop) throw new Error(`Azienda inesistente: ${dropId}`);
    const ids = { keep: keepId, drop: dropId };

    // Riferimenti ICP: quello del superstite resta, gli altri passano.
    db.prepare(
      `DELETE FROM icp_reference_companies WHERE company_id = @drop
         AND icp_id IN (SELECT icp_id FROM icp_reference_companies WHERE company_id = @keep)`,
    ).run(ids);
    db.prepare('UPDATE icp_reference_companies SET company_id = @keep WHERE company_id = @drop').run(ids);

    if (hasTable(db, 'icp_company_candidates')) {
      // La referenza vince sulla candidatura dello stesso ICP (referenze già spostate sul superstite).
      db.prepare(
        `DELETE FROM icp_company_candidates WHERE company_id IN (@keep, @drop)
           AND icp_id IN (SELECT icp_id FROM icp_reference_companies WHERE company_id = @keep)`,
      ).run(ids);
      // Due candidature dello stesso ICP: la decisa vince sulla proposta, a parità quella del superstite.
      db.prepare(
        `DELETE FROM icp_company_candidates WHERE company_id = @keep AND status = 'proposta'
           AND icp_id IN (SELECT icp_id FROM icp_company_candidates WHERE company_id = @drop AND status <> 'proposta')`,
      ).run(ids);
      db.prepare(
        `DELETE FROM icp_company_candidates WHERE company_id = @drop
           AND icp_id IN (SELECT icp_id FROM icp_company_candidates WHERE company_id = @keep)`,
      ).run(ids);
      db.prepare('UPDATE icp_company_candidates SET company_id = @keep WHERE company_id = @drop').run(ids);
    }

    db.prepare('UPDATE prospects SET company_id = @keep WHERE company_id = @drop').run(ids);

    // Fonti: `sources.company_id` è RESTRICT, quindi tutte spostate o fuse prima di cancellare l'assorbita.
    db.prepare(
      `DELETE FROM sources WHERE company_id = @keep
         AND EXISTS (SELECT 1 FROM sources d WHERE d.company_id = @drop AND d.prospect_id = sources.prospect_id
                       AND d.kind = sources.kind AND d.captured_at > sources.captured_at)`,
    ).run(ids);
    db.prepare(
      `DELETE FROM sources WHERE company_id = @drop
         AND EXISTS (SELECT 1 FROM sources k WHERE k.company_id = @keep AND k.prospect_id = sources.prospect_id
                       AND k.kind = sources.kind)`,
    ).run(ids);
    db.prepare('UPDATE sources SET company_id = @keep WHERE company_id = @drop').run(ids);

    db.prepare('DELETE FROM companies WHERE id = ?').run(dropId);

    const apollo = apolloSource(keep, drop);
    db.prepare(
      `UPDATE companies SET
         linkedin_url = @linkedin_url, domain = @domain, name = @name, website = @website, industry = @industry,
         size = @size, location = @location, notes = @notes,
         apollo_org_id = @apollo_org_id, apollo_json = @apollo_json, apollo_enriched_at = @apollo_enriched_at,
         created_at = MIN(created_at, @created_at), updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id: keepId,
      linkedin_url: fill(keep.linkedin_url, drop.linkedin_url),
      domain: fill(keep.domain, drop.domain),
      name: fill(keep.name, drop.name),
      website: fill(keep.website, drop.website),
      industry: fill(keep.industry, drop.industry),
      size: fill(keep.size, drop.size),
      location: fill(keep.location, drop.location),
      notes: joinNotes(keep.notes, drop.notes),
      apollo_org_id: apollo.apollo_org_id,
      apollo_json: apollo.apollo_json,
      apollo_enriched_at: apollo.apollo_enriched_at,
      created_at: drop.created_at,
      updated_at: nowIso(),
    });
    return select.get(keepId) as Company;
  })();
}
