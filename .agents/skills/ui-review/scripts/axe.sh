#!/usr/bin/env bash
# ui-review axe runner (SPEC D6): a second opinion on the page open in the agent-browser
# session, and a source of "needs review" items. Never the only check.
#
#   bash <skillsDir>/ui-review/scripts/axe.sh '<json-args>' [--session <name>]
#
#   {"scope": "<sel>", "tags": ["wcag2a", "wcag2aa", ...], "rules": ["color-contrast", ...],
#    "project": "/abs/project/root"}
#
# The source, in order. It never fetches anything from the network and never installs:
#   1. `agent-browser a11y` (axe built in) when `agent-browser --version` is 0.33.0 or later;
#   2. axe-core from disk, injected with `eval --stdin`, then axe.run on the scope:
#      $AXE_CORE_DIR/axe.min.js when AXE_CORE_DIR is set, else
#      <project>/node_modules/axe-core/axe.min.js (project: args.project, default the
#      working directory). Injected again after any navigation, reload or `vitals`: the
#      script checks for window.axe on every run;
#   3. none: {"source": "none"}. The contrast probe still runs; Engines says "axe not available".
#
# Prints exactly one JSON document: {source, version, scope, violations, needsReview}. Each
# item has the rule id, impact, help and its nodes (target, an html excerpt, the failure
# summary, and the check data, such as the colours and ratio of color-contrast). A default
# run skips target-size (off by default) and label-content-name-mismatch (experimental):
# name them in `rules` to run them. On failure: {"error": ...} and exit 1. Installed skill
# files lose the exec bit: always call it with bash.

set -uo pipefail

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ui-review-axe.XXXXXX") || {
  printf '{"error":"cannot create a temporary directory"}\n'
  exit 1
}
trap 'rm -rf "$TMP"' EXIT
ARGS=""
SESSION_FLAGS=()

fail() {  # fail <message>: print the error document and exit 1
  node -e 'process.stdout.write(JSON.stringify({ error: process.argv[1] }) + "\n")' -- "$1" 2>/dev/null ||
    printf '{"error":"axe.sh failed, and node is not available to report why"}\n'
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      [ $# -ge 2 ] || fail "--session needs a name"
      SESSION_FLAGS=(--session "$2")
      shift 2
      ;;
    --session=*)
      SESSION_FLAGS=(--session "${1#--session=}")
      shift
      ;;
    *)
      [ -z "$ARGS" ] || fail "unexpected argument: $1; usage: bash axe.sh '<json-args>' [--session <name>]"
      ARGS=$1
      shift
      ;;
  esac
done
[ -n "$ARGS" ] || ARGS='{}'
command -v node >/dev/null 2>&1 || fail "node is required (it parses the JSON arguments)"
command -v agent-browser >/dev/null 2>&1 || fail "agent-browser is not on PATH"

# Arguments, checked and normalised: {scope, tags, rules, project}.
CFG=$(node -e '
const a = JSON.parse(process.argv[1]);
if (a === null || typeof a !== "object" || Array.isArray(a)) throw new Error("args must be a JSON object");
const list = (v, name) => {
  if (v == null) return null;
  if (!Array.isArray(v) || !v.length || v.some((s) => typeof s !== "string" || !s)) throw new Error("args." + name + " must be a non-empty list of strings");
  return v;
};
if (a.scope != null && (typeof a.scope !== "string" || !a.scope.trim())) throw new Error("args.scope must be a CSS selector");
if (a.project != null && (typeof a.project !== "string" || !a.project.startsWith("/"))) throw new Error("args.project must be an absolute path");
process.stdout.write(JSON.stringify({ scope: a.scope || null, tags: list(a.tags, "tags"), rules: list(a.rules, "rules"), project: a.project || process.cwd() }));
' -- "$ARGS" 2>"$TMP/err") || fail "bad args: $(sed -n '/Error:/{s/.*Error: //;p;q;}' "$TMP/err")"

cfg() { node -e 'const v = JSON.parse(process.argv[1])[process.argv[2]]; process.stdout.write(v == null ? "" : Array.isArray(v) ? v.join(",") : String(v))' -- "$CFG" "$1"; }

# The in-page run, and the shape every source is reported in.
SLIM=$(cat <<'JS'
const slim = (items) => (items || []).map((v) => ({
  id: v.id, impact: v.impact ?? null, help: v.help ?? v.description ?? null, helpUrl: v.helpUrl ?? null,
  tags: (v.tags || []).filter((t) => /^(wcag|best-practice|experimental)/.test(t)),
  nodes: (v.nodes || []).map((n) => ({
    target: Array.isArray(n.target) ? n.target.map((t) => (Array.isArray(t) ? t.join(' ') : String(t))) : [String(n.target ?? n.selector ?? '')],
    html: typeof n.html === 'string' ? n.html.slice(0, 200) : null,
    failureSummary: n.failureSummary ?? null,
    data: [...(n.any || []), ...(n.all || []), ...(n.none || [])].map((c) => c.data).find((d) => d && typeof d === 'object') ?? null
  }))
}));
JS
)

report() {  # report <source> <envelope-json-file>: normalise an agent-browser --json envelope
  SOURCE="$1" SCOPE="$(cfg scope)" RULES="$(cfg rules)" node -e "$SLIM"'
const fs = require("fs");
const env = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!env.success) { process.stderr.write(String(env.error || "agent-browser failed")); process.exit(2); }
let d = env.data;
if (d && d.result !== undefined) d = d.result;
if (d && d.results) d = d.results;
const rules = process.env.RULES ? process.env.RULES.split(",") : null;
const keep = (items) => slim(items).filter((v) => !rules || rules.includes(v.id));
const out = {
  source: process.env.SOURCE,
  version: (d && (d.version || (d.testEngine && d.testEngine.version))) || null,
  scope: process.env.SCOPE || null,
  violations: keep(d && d.violations),
  needsReview: keep(d && (d.incomplete || d.needsReview))
};
if (!d || (!d.violations && !d.incomplete && !d.needsReview)) out.raw = d;
process.stdout.write(JSON.stringify(out) + "\n");
' "$2" 2>"$TMP/err" || fail "$1: $(cat "$TMP/err")"
}

ab_json() {  # ab_json <out-file> <command...>: one agent-browser --json command; its envelope goes to the file
  local out=$1
  shift
  agent-browser ${SESSION_FLAGS[@]+"${SESSION_FLAGS[@]}"} --json "$@" >"$out" 2>"$TMP/ab.err"
}

# 1. agent-browser a11y, from 0.33.0.
VERSION=$(agent-browser --version 2>/dev/null | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1)
if node -e 'const [a, b] = process.argv[1].split(".").map(Number); process.exit(a > 0 || b >= 33 ? 0 : 1)' -- "${VERSION:-0.0.0}"; then
  set -- a11y
  [ -z "$(cfg scope)" ] || set -- "$@" --selector "$(cfg scope)"
  [ -z "$(cfg tags)" ] || set -- "$@" --tags "$(cfg tags)"
  ab_json "$TMP/a11y.json" "$@" || fail "agent-browser a11y: $(cat "$TMP/a11y.json" "$TMP/ab.err" 2>/dev/null | tr '\n' ' ')"
  report a11y "$TMP/a11y.json"
  exit 0
fi

# 2. axe-core on disk.
if [ -n "${AXE_CORE_DIR:-}" ]; then
  AXE="$AXE_CORE_DIR/axe.min.js"
  [ -f "$AXE" ] || fail "AXE_CORE_DIR is set, but $AXE does not exist"
else
  AXE="$(cfg project)/node_modules/axe-core/axe.min.js"
fi

# 3. None.
if [ ! -f "$AXE" ]; then
  node -e 'process.stdout.write(JSON.stringify({ source: "none", agentBrowser: process.argv[1] || null, looked: [process.argv[2]] }) + "\n")' -- "$VERSION" "$AXE"
  exit 0
fi

# Inject once per page: the trailing expression makes eval print a small value, not axe.
printf '(() => typeof window.axe === "object" && typeof window.axe.run === "function")()' |
  ab_json "$TMP/has.json" eval --stdin || fail "agent-browser eval: $(cat "$TMP/ab.err")"
if ! node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).data.result === true ? 0 : 1)' -- "$TMP/has.json" 2>/dev/null; then
  { cat "$AXE"; printf '\n;(typeof window.axe === "object" ? window.axe.version : null);\n'; } |
    ab_json "$TMP/inject.json" eval --stdin || fail "injecting $AXE: $(cat "$TMP/inject.json" "$TMP/ab.err" 2>/dev/null | tr '\n' ' ')"
fi

{
  cat <<'JS'
(async (args) => {
  if (typeof window.axe !== 'object') throw new Error('axe-core did not load in the page');
  if (args.scope && !document.querySelector(args.scope)) throw new Error('scope not found: ' + args.scope);
  const options = { resultTypes: ['violations', 'incomplete'] };
  if (args.rules) options.runOnly = { type: 'rule', values: args.rules };
  else if (args.tags) options.runOnly = { type: 'tag', values: args.tags };
  const r = await window.axe.run(args.scope || document, options);
  // Only what the report keeps, so a large page does not print megabytes.
  const checks = (list) => (list || []).map((c) => ({ data: c.data ?? null }));
  const trim = (items) => items.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags,
    nodes: v.nodes.map((n) => ({ target: n.target, html: (n.html || '').slice(0, 200), failureSummary: n.failureSummary, any: checks(n.any), all: checks(n.all), none: checks(n.none) }))
  }));
  return { version: window.axe.version, violations: trim(r.violations), incomplete: trim(r.incomplete) };
JS
  printf '})(%s)\n' "$CFG"
} | ab_json "$TMP/run.json" eval --stdin || fail "axe.run: $(cat "$TMP/run.json" "$TMP/ab.err" 2>/dev/null | tr '\n' ' ')"
report node_modules "$TMP/run.json"
