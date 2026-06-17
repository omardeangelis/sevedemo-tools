---
domain: lead-engine
type: review-rubric
scope: spec
spec: selections-filters-ux
links:
  - "[[specs/lead-engine/selections-filters-ux/REPORT]]"
created: 2026-06-16
updated: 2026-06-16
---

# Review Rubric: selections-filters-ux (spec implementation)

## Change set under review

- **Scope:** spec implementation
- **Target:** spec implementation — `web/` UI/UX refresh adopting shadcn/ui
- **Compared:** working-tree `HEAD` → uncommitted working tree
- **Files touched:** 14 source files + config/deps, domain: lead-engine. New: `components/ui/*` (shadcn), `lib/utils.ts`, `components/filters/{FilterBar,FilterChips,emailOptions}`, `components/AddContactsDialog.tsx`. Edited: `api/client.ts` (ApiError), `routes/{contacts.index,selections.$date,selections.index,runs}.tsx`, `styles.css`, `tsconfig.json`, `vite.config.ts`.

## Routing rubric (review-classifier output)

```json
{
  "taskType": "ui",
  "secondaryType": "refactor",
  "domainsTouched": ["lead-engine"],
  "adversarialVerifiers": {
    "count": 5,
    "passes": [
      { "id": "v1", "charter": "Verify the 409 dual-meaning classification: classifyAddResult + ApiError.status + the message branch must distinguish 'Contatto già presente' (SKIP, counted as saltato) from 'Selezione esportata: editing bloccato' (FATAL read-only stop) on every add path (single and bulk). A misclassification = duplicate silently surfaced as a hard error, or an exported-abort masked as a benign skip.", "complexity": "high" },
      { "id": "v2", "charter": "Verify the bulk-add best-effort correctness: per-id selection Set survives search/filter changes (per-id not per-view), fan-out N client-side POSTs isolate per item so one failure never rolls back successes, the exported-abort stops the batch coherently, retry-only-failed retries exactly the failed items with no double-count of already-added items, and the aggiunti/saltati/errori tally is exact. Domain 'best-effort con isolamento per item' invariant.", "complexity": "high" },
      { "id": "v3", "charter": "Verify the URL filter/session persistence no-regression invariant: validateSearch still persists q/bucket/status/strategy/email/page in the URL, 'solo email-ready' moved from local useState into emailReady search field without breaking default-stripping, a filter change resets page->1, and reload on page 3 stays page 3. Invariant of email-segmentation-filters / stato-filtri-url; page is a persisted field.", "complexity": "medium" },
      { "id": "v4", "charter": "Verify the shared-component unification (Outcome D, tech-debt TD-1): FilterBar/FilterChips and the single emailOptions module genuinely replace both prior forks (EMAIL_OPTIONS and EMAIL_FILTER_OPTIONS), the pool reuses the same filter component, and no email-filter or filter-pattern fork remains after the inline AddPanel removal.", "complexity": "medium" },
      { "id": "v5", "charter": "Verify the shadcn introduction does not break out-of-scope pages or accessibility invariants: global styles.css CSS vars / Tailwind v4 @theme inline / *{border-border} base layer + new @/ alias must not regress Dashboard/Run/Report; the Dialog must provide focus-trap/Escape/restore-focus + live-region 'N selezionati', the remove action must be focusable (not hover-only opacity:0), the envelope marker must not be color-only. Functional-invariance + SPEC accessibility; agent-browser is the validation channel.", "complexity": "medium" }
    ]
  },
  "taskComplexity": "high",
  "reviewImpact": "critical",
  "humanInLoop": true,
  "nextStep": "Fan out 5 independent adversarial-verifier passes: v1/v2 strongest model (409 + bulk correctness); v3/v4/v5 mid-tier. v3/v5 validated via agent-browser (project convention: no FE unit runner). reviewImpact critical → REPORT must carry a human checklist."
}
```

## Classifier rationale

Functionally-invariant `ui` work (secondary `refactor`: unifies the TD-1 email-option fork + migrates to shadcn). Single `lead-engine` domain, confined to `web/`. No generic risk surface touched (auth/payments/migrations/secrets/PII/injection/CI) — server/DB/endpoints unchanged; the only untrusted input is URL search params already validated by `validateSearch`. Escalation to `critical`/`humanInLoop:true` is driven by three documented **no-regression invariants** the refactor sits on top of: the 409 dual-meaning, the domain "best-effort con isolamento per item" invariant (now reimplemented client-side), and the URL/`page` persistence invariant from the shipped email-segmentation-filters / stato-filtri-url spec. Each highest-risk area maps to one isolated verifier; v1 (status branching) and v2 (batch state) are split because they are distinct seams.

## Overrides applied

- **Charter typo corrected for Stage 2 (not a routing change):** v1's paraphrase wrote the message regex as `/esordat|esportat/i`; the actual code uses `/esportat/i`. The v1 verifier was briefed with the correct regex. No change to pass count, complexity, impact, or humanInLoop.

## Verification plan (derived)

| Pass | Charter | Complexity | Model tier |
|------|---------|------------|------------|
| v1 | 409 dual-meaning classification (single + bulk) | high | strongest (Opus-class) |
| v2 | Bulk best-effort isolation + exported-abort + retry-only-failed + exact tally | high | strongest (Opus-class) |
| v3 | URL filter/session persistence incl. `page`; emailReady migration | medium | mid-tier |
| v4 | Shared-component unification + fork removal (TD-1 / Outcome D) | medium | mid-tier |
| v5 | shadcn blast radius on out-of-scope pages + a11y invariants | medium | mid-tier |
