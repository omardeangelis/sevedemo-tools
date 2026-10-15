#!/usr/bin/env bash
# ui-review probe runner.
#
#   bash <skillsDir>/ui-review/scripts/probe.sh <probe> '<json-args>' [--session <name>]
#
# Runs one probe on the page already open in the agent-browser session (the
# default session without --session) and prints exactly one JSON document on
# stdout. On failure the document is {"probe": ..., "error": ...} and the exit
# code is 1. Installed skill files lose the exec bit: always call it with bash.
#
# Each probe has one in-page file, probes/<probe>.js: a single function
# expression that takes the parsed args and returns a plain object, never a
# JSON.stringify string (eval prints a string as a quoted literal). The runner
# wraps it as ((<file>)(<args>)) inside an async IIFE, so nothing leaks between
# calls, and pipes it to `agent-browser eval --stdin`. A probe that changes the
# viewport, reloads or clicks also has a step_<probe> function below that
# drives agent-browser and calls its in-page file; any other probe is in-page
# only. Arguments are JSON, parsed with node (never jq). Screenshot paths are
# absolute: agent-browser resolves a relative path against its daemon's
# directory, not the caller's.
#
# width-sweep  {"targets": ["<container>", ...], "min": 280, "max": 1440, "height": 800,
#               "breakpoints": [<px>, ...], "fontScale": 1.25, "settle": 0}
#   Widths from min to max in steps of at most 16 px below 480 and 60 px above, every
#   breakpoint ±1 (from args, else from the stylesheets' media queries), a binary search
#   wherever a target's row count or box signature changes, then the whole sweep again
#   at fontScale x the root font size (false skips it). Returns, per pass and target,
#   ranges {from, to, rows, containerWidth: [at from, at to], overflowX}.
# resize       {"trigger": "<sel>" | ["<sel>", ...], "overlay": "<sel>", "wide": 1440,
#               "narrow": 280, "height": 800, "settle": 300, "shots": "/abs/dir"}
#   Reload at the wide width, click the trigger(s) in order, measure; resize to the
#   narrow width, measure; reload there, click, measure. Returns the three boxes
#   (opened, resized, fresh), delta = resized - fresh, and matchesFresh.
# edge         {"trigger": "<sel>", "overlay": "<sel>", "viewport": [w, h], "inset": 8,
#               "placements": ["top", "middle", "bottom"], "settle": 0, "reload": true,
#               "shots": "/abs/dir"}
#   Per placement: reload, scroll the trigger to the top, middle or bottom of the
#   viewport, click it, measure. Returns each placement with the overlay box and its
#   distance to each viewport edge (negative = past the edge), and coversTrigger.
#
# focus-ring   {"controls": ["<sel>", ...] | "scope": "<sel>", "maxTabs": 3, "shots": "/abs/dir"}
#   Per control (the listed ones, else every tabbable control in scope, in Tab order):
#   focus the control before it, real `press Tab` until it has focus (never `focus`: it
#   paints no :focus-visible), screenshot, blur (focus moves to BODY), screenshot. Returns
#   per control ringKind (outline | box-shadow | none), ringOwner (the control, or the label
#   or ancestor whose ring appears only with focus), the ring rect, clippedPx and
#   clippedFraction with the clipAncestor that cuts it, obscuredFraction by fixed or sticky
#   layers, enclosesTarget (the ring holds the control and its labels), and cropDiffPct: the
#   share of pixels that differ between the focused and blurred shots, cropped to the clip
#   ancestor (else to the control and its ring, 8 px around). `screenshot <sel>` captures the
#   wrong region on a scrolled page in 0.27.1, so the runner crops viewport shots in node;
#   with shots, the two crops are kept there.
# hit-area     {"control": "<sel>", "hover": "<sel>", "standard": 24, "step": 4, "clicks": 8}
#   elementFromPoint on a 4 px grid over the hover box (what highlights; default the
#   control), no clicks: a point responds when it hits the control, its <label>, or a
#   descendant of either. Then real mouse move/down/up at no more than 8 of the points (the
#   centre, inside and outside the responding region), reading the state after each and
#   clicking again where it toggled. Returns coverage, the responding box against the
#   standard, and the clicks with responded, toggled and restored.
# contrast     {"targets": ["<sel>", ...], "states": ["default" | "hover" | "focus" |
#               {"name": "...", "cli" | "js": "..."}], "themes": ["light" | "dark" |
#               {"name": "...", "media": "light" | "dark", "cli" | "js": "..."}], "maxTabs": 3}
#   Per theme and state, each target's text colour against its background composited
#   through the ancestors. Returns the ratio, the colours, font size and weight, the required
#   ratio, and needsReview (gradient, image, opacity, filter, blend mode, text shadow). A
#   media theme is restored afterwards; a cli or js theme is the caller's to undo.
# layout-jump  {"watch": ["<sel>", ...], "action": {"cli": "<agent-browser subcommand>"} |
#               {"js": "<page expression>"}, "settleMs": 600}
#   Installs a layout-shift observer and an animation log, runs the action, waits settleMs.
#   Returns each shift with animating: true when an animation related to one of its
#   sources ran at that time (motion, not UI), and each watched box before, after and the
#   delta. The action must not navigate or reload: that drops the observer.
#
# resize and edge reload the page: a state forced in memory is lost, so reach the
# surface through the trigger list or the URL. Every probe restores the viewport.

set -uo pipefail

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ui-review-probe.XXXXXX") || {
  printf '{"probe":null,"error":"cannot create a temporary directory"}\n'
  exit 1
}
ERR="$TMP/error.json"
exec 3>&1  # the real stdout: the EXIT trap prints there even when it fires inside a `>/dev/null` call
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROBES="$(dirname "$HERE")/probes"
PROBE=""
ARGS=""
SESSION_FLAGS=()
CLEANUP=""
ORIG_W=""
ORIG_H=""

# Helpers shared by every node call: argument checks, sweep widths, reports.
NODE_LIB=$(cat <<'JS'
const fs = require('fs');
const round = (n) => Math.round(n * 100) / 100;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ndjson = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const parseArgs = (a) => { if (!isObj(a)) throw new Error('args must be a JSON object'); return a; };
const num = (v, fallback, name) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('args.' + name + ' must be a number');
  return v;
};
const sel = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error('args.' + name + ' must be a CSS selector');
  return v;
};
const shotsDir = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !v.startsWith('/')) throw new Error('args.shots must be an absolute directory path');
  return v.replace(/\/+$/, '') || '/';
};

const sweepConfig = (a) => {
  if (!Array.isArray(a.targets) || !a.targets.length) throw new Error('args.targets must be a non-empty list of container selectors');
  a.targets.forEach((t, i) => sel(t, 'targets[' + i + ']'));
  const min = Math.round(num(a.min, 280, 'min')), max = Math.round(num(a.max, 1440, 'max'));
  if (min < 1 || max < min) throw new Error('args.min and args.max must satisfy 1 <= min <= max');
  if (a.breakpoints != null && (!Array.isArray(a.breakpoints) || a.breakpoints.some((b) => typeof b !== 'number'))) {
    throw new Error('args.breakpoints must be a list of widths in px');
  }
  const fontScale = a.fontScale === false ? null : num(a.fontScale, 1.25, 'fontScale');
  return {
    targets: a.targets, min, max,
    height: Math.round(num(a.height, 800, 'height')),
    fontScale: fontScale === 1 ? null : fontScale,
    settle: num(a.settle, 0, 'settle'),
    breakpoints: a.breakpoints ? a.breakpoints.map(Math.round) : null
  };
};
const sweepWidths = (cfg, breakpoints) => {
  const widths = new Set([cfg.min, cfg.max]);
  for (let w = cfg.min; w < Math.min(480, cfg.max); w += 16) widths.add(w);
  for (let w = Math.max(cfg.min, 480); w < cfg.max; w += 60) widths.add(w);
  for (const b of breakpoints) for (const w of [b - 1, b, b + 1]) if (w >= cfg.min && w <= cfg.max) widths.add(w);
  return [...widths].sort((x, y) => x - y);
};
const sweepReport = (cfg, init, breakpoints, source, lines) => ({
  probe: 'width-sweep',
  min: cfg.min, max: cfg.max, height: cfg.height,
  breakpoints, breakpointSource: source, unreadableSheets: init.unreadableSheets,
  samples: lines.length,
  passes: [1].concat(cfg.fontScale ? [cfg.fontScale] : []).map((scale) => {
    const samples = lines.filter((l) => l.scale === scale).map((l) => l.sample).sort((x, y) => x.width - y.width);
    return {
      fontScale: scale,
      rootFontPx: samples.length ? samples[0].rootFontPx : null,
      targets: cfg.targets.map((selector, i) => {
        const ranges = [];
        for (const s of samples) {
          const t = s.targets[i], last = ranges[ranges.length - 1];
          if (last && last.rows === t.rows && last.overflowX === t.overflowX && !last.missing === t.found) {
            last.to = s.width;
            last.containerWidth[1] = t.containerWidth;
          } else {
            ranges.push(Object.assign(
              { from: s.width, to: s.width, rows: t.rows, containerWidth: [t.containerWidth, t.containerWidth], overflowX: t.overflowX },
              t.found ? {} : { missing: true }
            ));
          }
        }
        return { selector, ranges };
      })
    };
  })
});

const resizeConfig = (a) => {
  const triggers = [].concat(a.trigger ?? []);
  if (!triggers.length) throw new Error('args.trigger must be a selector, or a list of selectors clicked in order');
  triggers.forEach((t, i) => sel(t, 'trigger[' + i + ']'));
  const wide = Math.round(num(a.wide, 1440, 'wide')), narrow = Math.round(num(a.narrow, 280, 'narrow'));
  if (narrow < 1 || narrow >= wide) throw new Error('args.narrow must be smaller than args.wide');
  return {
    triggers, overlay: sel(a.overlay, 'overlay'), wide, narrow,
    height: Math.round(num(a.height, 800, 'height')),
    settle: num(a.settle, 300, 'settle'),
    shots: shotsDir(a.shots)
  };
};
const resizeReport = (cfg, opened, resized, fresh, shots) => {
  const delta = resized.box && fresh.box
    ? { x: round(resized.box.x - fresh.box.x), y: round(resized.box.y - fresh.box.y), width: round(resized.box.width - fresh.box.width), height: round(resized.box.height - fresh.box.height) }
    : null;
  const pastViewport = (m) => (m.box ? m.box.x < -0.5 || m.box.right > m.viewport.width + 0.5 : null);
  return Object.assign({
    probe: 'resize', trigger: cfg.triggers, overlay: cfg.overlay, wide: cfg.wide, narrow: cfg.narrow, height: cfg.height,
    opened, resized, fresh, delta,
    matchesFresh: !!delta && resized.visible === fresh.visible && Object.values(delta).every((v) => Math.abs(v) <= 1),
    pastViewport: { resized: pastViewport(resized), fresh: pastViewport(fresh) }
  }, shots ? { shots } : {});
};

const edgeConfig = (a) => {
  const placements = a.placements ?? ['top', 'middle', 'bottom'];
  if (!Array.isArray(placements) || !placements.length || placements.some((p) => !['top', 'middle', 'bottom'].includes(p))) {
    throw new Error('args.placements must list top, middle and/or bottom');
  }
  if (a.viewport != null && (!Array.isArray(a.viewport) || a.viewport.length !== 2 || a.viewport.some((n) => typeof n !== 'number'))) {
    throw new Error('args.viewport must be [width, height]');
  }
  return {
    trigger: sel(a.trigger, 'trigger'), overlay: sel(a.overlay, 'overlay'), placements,
    viewport: a.viewport ? a.viewport.map(Math.round) : null,
    inset: num(a.inset, 8, 'inset'),
    settle: num(a.settle, 0, 'settle'),
    reload: a.reload !== false,
    shots: shotsDir(a.shots)
  };
};
const edgeReport = (cfg, lines) => ({
  probe: 'edge', trigger: cfg.trigger, overlay: cfg.overlay, inset: cfg.inset,
  viewport: lines.length ? lines[0].measure.viewport : null,
  placements: lines.map((l) => Object.assign({
    placement: l.placement,
    reached: l.place.reached,
    trigger: l.measure.trigger,
    visible: l.measure.visible,
    overlay: l.measure.overlay ?? null,
    distance: l.measure.distance ?? null,
    coversTrigger: l.measure.coversTrigger ?? false
  }, l.shot ? { shot: l.shot } : {}))
});

// An agent-browser subcommand as words: a list, or a string split as a shell would (single
// and double quotes, backslash escapes). A leading "agent-browser" is dropped.
const cliWords = (v, name) => {
  let words;
  if (Array.isArray(v)) {
    if (v.some((w) => typeof w !== 'string')) throw new Error(name + ' must be a string or a list of strings');
    words = v.slice();
  } else if (typeof v === 'string') {
    words = [];
    let cur = null, q = null;
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      if (q) {
        if (ch === q) q = null;
        else if (ch === '\\' && q === '"' && i + 1 < v.length) cur += v[++i];
        else cur += ch;
      } else if (ch === '"' || ch === "'") { q = ch; cur = cur ?? ''; }
      else if (/\s/.test(ch)) { if (cur !== null) { words.push(cur); cur = null; } }
      else if (ch === '\\' && i + 1 < v.length) cur = (cur ?? '') + v[++i];
      else cur = (cur ?? '') + ch;
    }
    if (q) throw new Error(name + ' has an unclosed quote');
    if (cur !== null) words.push(cur);
  } else {
    throw new Error(name + ' must be an agent-browser subcommand');
  }
  if (words[0] === 'agent-browser') words.shift();
  if (!words.length) throw new Error(name + ' must be an agent-browser subcommand');
  return words;
};
const action = (v, name) => {
  if (!isObj(v) || (v.cli === undefined) === (v.js === undefined)) {
    throw new Error(name + ' must be {"cli": "<agent-browser subcommand>"} or {"js": "<page expression>"}');
  }
  if (v.cli !== undefined) return { cli: cliWords(v.cli, name + '.cli') };
  if (typeof v.js !== 'string' || !v.js.trim()) throw new Error(name + '.js must be a page expression');
  return { js: v.js };
};
const selList = (v, name, required) => {
  if (v == null && !required) return null;
  if (!Array.isArray(v) || !v.length) throw new Error('args.' + name + ' must be a non-empty list of selectors');
  v.forEach((s, i) => sel(s, name + '[' + i + ']'));
  return v;
};

// PNG with no dependency: 8-bit, non-interlaced grey, grey+alpha, RGB or RGBA (what Chromium writes).
const zlib = require('zlib');
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const readPng = (file) => {
  const b = fs.readFileSync(file);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) throw new Error(file + ' is not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, type = -1, interlace = 0;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos), kind = b.toString('ascii', pos + 4, pos + 8), data = b.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const channels = CHANNELS[type];
  if (depth !== 8 || !channels || interlace) throw new Error(file + ': only 8-bit non-interlaced grey, RGB or RGBA PNGs are supported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels] : 0, u = y ? px[up + x] : 0, ul = y && x >= channels ? px[up + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += u;
      else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const p = a + u - ul, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : ul; }
      px[row + x] = v & 255;
    }
  }
  return { width, height, channels, px };
};
const writePng = (file, img) => {
  const stride = img.width * img.channels, raw = Buffer.alloc(img.height * (stride + 1));
  for (let y = 0; y < img.height; y++) img.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (kind, data) => {
    const head = Buffer.alloc(4), body = Buffer.concat([Buffer.from(kind, 'ascii'), data]), crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = Number(Object.keys(CHANNELS).find((t) => CHANNELS[t] === img.channels));
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]));
};
const cropImage = (img, r) => {
  const px = Buffer.alloc(r.width * r.height * img.channels);
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * img.width + r.x) * img.channels;
    img.px.copy(px, y * r.width * img.channels, from, from + r.width * img.channels);
  }
  return { width: r.width, height: r.height, channels: img.channels, px };
};
// Crop two same-size viewport screenshots to a CSS-pixel rect and count the pixels that differ
// (any channel by more than 2). With `keep`, write both crops there.
const cropDiff = (aFile, bFile, rect, viewportWidth, keep) => {
  const a = readPng(aFile), b = readPng(bFile);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    return { cropDiffPct: null, cropError: 'the two screenshots differ in size (' + a.width + 'x' + a.height + ', ' + b.width + 'x' + b.height + ')' };
  }
  const scale = a.width / viewportWidth;
  const x = Math.max(0, Math.floor(rect.x * scale)), y = Math.max(0, Math.floor(rect.y * scale));
  const r = { x, y, width: Math.min(a.width, Math.ceil(rect.right * scale)) - x, height: Math.min(a.height, Math.ceil(rect.bottom * scale)) - y };
  if (r.width <= 0 || r.height <= 0) return { cropDiffPct: null, cropError: 'the crop is outside the viewport' };
  const ca = cropImage(a, r), cb = cropImage(b, r);
  let diff = 0;
  for (let i = 0; i < ca.px.length; i += ca.channels) {
    for (let c = 0; c < ca.channels; c++) if (Math.abs(ca.px[i + c] - cb.px[i + c]) > 2) { diff += 1; break; }
  }
  const out = { cropPx: { width: r.width, height: r.height }, cropDiffPx: diff, cropDiffPct: round((diff / (r.width * r.height)) * 100) };
  if (keep) {
    writePng(keep.focused, ca);
    writePng(keep.unfocused, cb);
    out.shots = keep;
  }
  return out;
};

const focusConfig = (a) => ({
  controls: selList(a.controls, 'controls', false),
  scope: a.scope == null ? 'body' : sel(a.scope, 'scope'),
  maxTabs: Math.max(1, Math.round(num(a.maxTabs, 3, 'maxTabs'))),
  shots: shotsDir(a.shots)
});
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'control';
const focusEntry = (index, entry, check, res, files, shots) => {
  const { active, viewport, devicePixelRatio, ...ring } = res;
  const name = shots + '/focus-' + index + '-' + slug(entry.selector);
  const keep = shots ? { focused: name + '-focused.png', unfocused: name + '-unfocused.png' } : null;
  const diff = res.crop
    ? cropDiff(files.focused, files.unfocused, res.crop, viewport.width, keep)
    : { cropDiffPct: null, cropError: 'the control is outside the viewport' };
  return Object.assign({ selector: entry.selector, reached: true, focusVisible: check.focusVisible, tabs: check.tabs }, ring, diff, { viewport, devicePixelRatio });
};
const focusMissed = (entry, check) => Object.assign(
  { selector: entry.selector, reached: false },
  entry.found ? {} : { found: false },
  entry.found && !entry.tabbable ? { tabbable: false } : {},
  check ? { tabs: check.tabs, active: check.active ?? null } : {}
);
const focusReport = (cfg, lines) => ({ probe: 'focus-ring', scope: cfg.controls ? null : cfg.scope, maxTabs: cfg.maxTabs, controls: lines });

const hitConfig = (a) => ({
  control: sel(a.control, 'control'),
  hover: a.hover == null ? a.control : sel(a.hover, 'hover'),
  standard: num(a.standard, 24, 'standard'),
  gridStep: Math.max(1, num(a.step, 4, 'step')),
  clicks: Math.max(0, Math.min(8, Math.round(num(a.clicks, 8, 'clicks'))))
});
const hitClick = (click, grid, after, again) => {
  const toggled = after.state !== grid.state;
  return {
    x: click.x, y: click.y, where: click.where, expected: click.expected,
    responded: after.clicks > 0 || toggled,
    toggled,
    restored: (again || after).state === grid.state
  };
};
const hitReport = (cfg, grid, lines, final) => ({
  probe: 'hit-area', control: cfg.control, hover: cfg.hover, standard: grid.standard,
  hoverBox: grid.hoverBox, gridStep: grid.gridStep, points: grid.points, offscreenPoints: grid.offscreenPoints,
  respondingPoints: grid.respondingPoints, coverage: grid.coverage,
  respondingBox: grid.respondingBox, respondingSize: grid.respondingSize, respondingElements: grid.respondingElements,
  meetsStandard: grid.meetsStandard,
  clicks: lines,
  clicksAgree: lines.every((c) => c.responded === c.expected),
  stateRestored: final.state === grid.state
});

const STATES = ['default', 'hover', 'focus'];
const contrastConfig = (a) => {
  const targets = selList(a.targets, 'targets', true);
  if (!Array.isArray(a.states ?? []) || !Array.isArray(a.themes ?? [])) throw new Error('args.states and args.themes must be lists');
  const states = (a.states ?? ['default']).map((s, i) => {
    const name = 'args.states[' + i + ']';
    if (typeof s === 'string') {
      if (!STATES.includes(s)) throw new Error(name + ' must be default, hover, focus, or {"name", "cli" | "js"}');
      return { name: s, kind: s };
    }
    if (!isObj(s) || typeof s.name !== 'string') throw new Error(name + ' must be default, hover, focus, or {"name", "cli" | "js"}');
    return Object.assign({ name: s.name, kind: 'action' }, action(s, name));
  });
  const themes = (a.themes ?? []).map((t, i) => {
    const name = 'args.themes[' + i + ']';
    if (t === 'light' || t === 'dark') return { name: t, media: t };
    if (!isObj(t) || typeof t.name !== 'string') throw new Error(name + ' must be light, dark, or {"name", "media", "cli" | "js"}');
    if (t.media != null && t.media !== 'light' && t.media !== 'dark') throw new Error(name + '.media must be light or dark');
    return Object.assign({ name: t.name, media: t.media ?? null }, t.cli !== undefined || t.js !== undefined ? action(t, name) : {});
  });
  return {
    targets, states,
    themes: themes.length ? themes : [{ name: 'current', media: null }],
    maxTabs: Math.max(1, Math.round(num(a.maxTabs, 3, 'maxTabs')))
  };
};

const jumpConfig = (a) => ({
  watch: selList(a.watch, 'watch', false) || [],
  action: action(a.action, 'args.action'),
  settleMs: Math.max(0, num(a.settleMs, 600, 'settleMs'))
});
JS
)

fail() {  # fail <message>: record the error document (the first one wins) and exit 1; the EXIT trap prints it
  if [ ! -s "$ERR" ]; then
    node -e 'process.stdout.write(JSON.stringify({ probe: process.argv[1] || null, error: process.argv[2] }) + "\n")' \
      -- "$PROBE" "$1" >"$ERR" 2>/dev/null || printf '{"probe":null,"error":"probe failed, and node is not available to report why"}\n' >"$ERR"
  fi
  exit 1
}

on_exit() {
  local code=$? saved=""
  if [ "$code" -ne 0 ]; then
    [ -s "$ERR" ] && saved=$(cat "$ERR")
    [ -n "$CLEANUP" ] && ( "$CLEANUP" ) >/dev/null 2>&1
    if [ -n "$saved" ]; then printf '%s\n' "$saved" >&3; else printf '{"probe":"%s","error":"probe runner exited with code %s"}\n' "$PROBE" "$code" >&3; fi
  fi
  rm -rf "$TMP"
  exit "$code"
}
trap on_exit EXIT

jx() {  # jx <js-expr> [json...]: evaluate the expression over A (the parsed JSON arguments); strings print raw, the rest as JSON
  local expr=$1
  shift
  node -e "$NODE_LIB
let v;
try { const A = process.argv.slice(1).map((x) => JSON.parse(x)); v = ($expr); }
catch (e) { process.stderr.write(e.message); process.exit(2); }
process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));" -- "$@"
}

ab_error() {  # ab_error <envelope>: the error message of a failed agent-browser call
  node -e 'let m = ""; try { m = JSON.parse(process.argv[1]).error || "" } catch {}
m = String(m || process.argv[2] || "failed").split("\n").filter((l) => !/^\s+at /.test(l)).join(" ");
process.stdout.write(m.replace(/\s+/g, " ").trim())' \
    -- "$1" "$(cat "$TMP/ab.err" 2>/dev/null)"
}

ab() {  # ab <command> [args...]: one agent-browser command; its JSON envelope goes to stdout
  local out
  if ! out=$(agent-browser ${SESSION_FLAGS[@]+"${SESSION_FLAGS[@]}"} --json "$@" </dev/null 2>"$TMP/ab.err" 3>&-); then
    fail "agent-browser $*: $(ab_error "$out")"
  fi
  printf '%s' "$out"
}

page_eval() {  # page_eval <label> [js-expr over R]: run the script on stdin in the page; print its result R as JSON, or the expression
  local out
  if ! out=$(agent-browser ${SESSION_FLAGS[@]+"${SESSION_FLAGS[@]}"} --json eval --stdin 2>"$TMP/ab.err" 3>&-); then
    fail "$1 in the page: $(ab_error "$out")"
  fi
  printf '%s' "$out" | node -e "$NODE_LIB
const envelope = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!envelope.success) { process.stderr.write(String(envelope.error)); process.exit(2); }
const R = envelope.data.result;
const v = (${2:-R});
process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));" 2>"$TMP/node.err" || fail "$1: $(cat "$TMP/node.err")"
}

inpage() {  # inpage <probe> <json-args> [js-expr over R]: run probes/<probe>.js in the page as ((<file>)(<args>))
  local file="$PROBES/$1.js"
  [ -f "$file" ] || fail "no in-page script for $1 (expected $file)"
  { printf '(async () => ((\n'; cat "$file"; printf '\n)(%s)))()\n' "$2"; } | page_eval "$1" "${3:-R}"
}

page_viewport() {  # sets ORIG_W and ORIG_H from the page
  local vp
  vp=$(printf '(() => ({ width: innerWidth, height: innerHeight }))()' | page_eval viewport 'R.width + " " + R.height') || exit 1
  ORIG_W=${vp% *}
  ORIG_H=${vp#* }
}

restore_viewport() {
  [ -n "$ORIG_W" ] && ab set viewport "$ORIG_W" "$ORIG_H" >/dev/null
}

# --- width-sweep --------------------------------------------------------------

sweep_measure() {  # sweep_measure <width> <scale>: record one sample; sets SIG to its box signature
  ab set viewport "$1" "$SW_HEIGHT" >/dev/null || exit 1
  SIG=$(inpage width-sweep "$SW_MEASURE" \
    "(fs.appendFileSync(process.env.UI_REVIEW_SAMPLES, JSON.stringify({ scale: $2, sample: R }) + '\n'), R.sig)") || exit 1
}

sweep_bisect() {  # sweep_bisect <lo> <sig-lo> <hi> <sig-hi> <scale>: sample down to 1 px wherever the signature changes
  local lo=$1 slo=$2 hi=$3 shi=$4 scale=$5 mid smid
  while [ $((hi - lo)) -gt 1 ]; do
    mid=$(((lo + hi) / 2))
    sweep_measure "$mid" "$scale"
    smid=$SIG
    if [ "$smid" = "$slo" ]; then
      lo=$mid
    elif [ "$smid" = "$shi" ]; then
      hi=$mid
    else
      sweep_bisect "$mid" "$smid" "$hi" "$shi" "$scale"
      hi=$mid
      shi=$smid
    fi
  done
}

sweep_cleanup() {
  inpage width-sweep '{"step":"restore"}' >/dev/null
  restore_viewport
}

step_width_sweep() {
  local cfg init bps source widths fscale scale w prev_w prev_s cur_s
  cfg=$(jx 'sweepConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  page_viewport
  CLEANUP=sweep_cleanup
  init=$(inpage width-sweep '{"step":"init"}') || exit 1
  bps=$(jx 'A[0].breakpoints || A[1].breakpoints' "$cfg" "$init") || exit 1
  source=$(jx 'A[0].breakpoints ? "args" : "stylesheets"' "$cfg") || exit 1
  widths=$(jx 'sweepWidths(A[0], A[1]).join(" ")' "$cfg" "$bps") || exit 1
  fscale=$(jx 'A[0].fontScale || ""' "$cfg") || exit 1
  SW_HEIGHT=$(jx 'A[0].height' "$cfg") || exit 1
  SW_MEASURE=$(jx 'JSON.stringify({ step: "measure", targets: A[0].targets, settle: A[0].settle })' "$cfg") || exit 1
  export UI_REVIEW_SAMPLES="$TMP/samples.ndjson"

  for scale in 1 $fscale; do
    if [ "$scale" != 1 ]; then
      inpage width-sweep "{\"step\":\"scale\",\"scale\":$scale}" >/dev/null || exit 1
    fi
    prev_w=""
    prev_s=""
    for w in $widths; do
      sweep_measure "$w" "$scale"
      if [ -n "$prev_w" ] && [ "$SIG" != "$prev_s" ]; then
        cur_s=$SIG
        sweep_bisect "$prev_w" "$prev_s" "$w" "$cur_s" "$scale"
        SIG=$cur_s
      fi
      prev_w=$w
      prev_s=$SIG
    done
  done

  sweep_cleanup || exit 1
  CLEANUP=""
  SOURCE="$source" jx 'sweepReport(A[0], A[1], A[2], process.env.SOURCE, ndjson(process.env.UI_REVIEW_SAMPLES))' "$cfg" "$init" "$bps"
}

# --- resize -------------------------------------------------------------------

click_triggers() {  # click each selector of $TRIGGERS (one per line), in order
  # A reload restores the scroll position, and `click` on an element outside the
  # viewport reports success without hitting it: scroll it into view first.
  local t
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    ab scrollintoview "$t" >/dev/null || exit 1
    ab click "$t" >/dev/null || exit 1
  done <<EOF
$TRIGGERS
EOF
}

shoot() {  # shoot <name>: screenshot into $SHOTS (absolute) and print the path; nothing without shots
  [ -n "$SHOTS" ] || return 0
  ab screenshot "$SHOTS/$1.png" >/dev/null || exit 1
  printf '%s' "$SHOTS/$1.png"
}

step_resize() {
  local cfg wide narrow height margs opened resized fresh shot_resized shot_fresh shots_json
  cfg=$(jx 'resizeConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  wide=$(jx 'A[0].wide' "$cfg") || exit 1
  narrow=$(jx 'A[0].narrow' "$cfg") || exit 1
  height=$(jx 'A[0].height' "$cfg") || exit 1
  TRIGGERS=$(jx 'A[0].triggers.join("\n")' "$cfg") || exit 1
  SHOTS=$(jx 'A[0].shots || ""' "$cfg") || exit 1
  margs=$(jx 'JSON.stringify({ overlay: A[0].overlay, settle: A[0].settle })' "$cfg") || exit 1
  [ -z "$SHOTS" ] || mkdir -p "$SHOTS" || fail "cannot create $SHOTS"
  page_viewport
  CLEANUP=restore_viewport

  ab set viewport "$wide" "$height" >/dev/null || exit 1
  ab reload >/dev/null || exit 1
  click_triggers
  opened=$(inpage resize "$margs") || exit 1

  ab set viewport "$narrow" "$height" >/dev/null || exit 1
  resized=$(inpage resize "$margs") || exit 1
  shot_resized=$(shoot resize-resized) || exit 1

  ab reload >/dev/null || exit 1
  click_triggers
  fresh=$(inpage resize "$margs") || exit 1
  shot_fresh=$(shoot resize-fresh) || exit 1

  restore_viewport || exit 1
  CLEANUP=""
  shots_json=$(SR="$shot_resized" SF="$shot_fresh" jx 'process.env.SR ? JSON.stringify({ resized: process.env.SR, fresh: process.env.SF }) : "null"') || exit 1
  jx 'resizeReport(A[0], A[1], A[2], A[3], A[4])' "$cfg" "$opened" "$resized" "$fresh" "$shots_json"
}

# --- edge ---------------------------------------------------------------------

step_edge() {
  local cfg trigger reload placements placement margs place meas shot
  cfg=$(jx 'edgeConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  trigger=$(jx 'A[0].trigger' "$cfg") || exit 1
  reload=$(jx 'A[0].reload' "$cfg") || exit 1
  placements=$(jx 'A[0].placements.join(" ")' "$cfg") || exit 1
  SHOTS=$(jx 'A[0].shots || ""' "$cfg") || exit 1
  margs=$(jx 'JSON.stringify({ step: "measure", trigger: A[0].trigger, overlay: A[0].overlay, settle: A[0].settle })' "$cfg") || exit 1
  [ -z "$SHOTS" ] || mkdir -p "$SHOTS" || fail "cannot create $SHOTS"
  page_viewport
  CLEANUP=restore_viewport
  if [ "$(jx 'A[0].viewport ? "yes" : ""' "$cfg")" = yes ]; then
    ab set viewport $(jx 'A[0].viewport.join(" ")' "$cfg") >/dev/null || exit 1
  fi
  export UI_REVIEW_EDGE="$TMP/edge.ndjson"

  for placement in $placements; do
    if [ "$reload" = true ]; then ab reload >/dev/null || exit 1; fi
    place=$(inpage edge "$(jx 'JSON.stringify({ step: "place", trigger: A[0].trigger, placement: A[1], inset: A[0].inset })' "$cfg" "\"$placement\"")") || exit 1
    ab click "$trigger" >/dev/null || exit 1
    meas=$(inpage edge "$margs") || exit 1
    shot=$(shoot "edge-$placement") || exit 1
    SHOT="$shot" jx 'fs.appendFileSync(process.env.UI_REVIEW_EDGE, JSON.stringify({ placement: A[0], place: A[1], measure: A[2], shot: process.env.SHOT || undefined }) + "\n"), ""' \
      "\"$placement\"" "$place" "$meas" || exit 1
  done

  restore_viewport || exit 1
  CLEANUP=""
  jx 'edgeReport(A[0], ndjson(process.env.UI_REVIEW_EDGE))' "$cfg"
}

# --- shared: actions, Tab, clicks ---------------------------------------------

run_action() {  # run_action <action-json>: {"cli": [words]} runs agent-browser; {"js": "<expr>"} awaits it in the page
  local words=() w kind
  kind=$(jx 'A[0].cli ? "cli" : "js"' "$1") || exit 1
  if [ "$kind" = cli ]; then
    while IFS= read -r -d '' w; do words+=("$w"); done < <(jx 'A[0].cli.map((w) => w + "\0").join("")' "$1")
    ab "${words[@]}" >/dev/null || exit 1
  else
    { printf '(async () => { await (\n'; jx 'A[0].js' "$1"; printf '\n); return { done: true }; })()\n'; } | page_eval action >/dev/null || exit 1
  fi
}

tab_to() {  # tab_to <selector-json> <max-tabs>: real Tab presses until the control has focus; prints the last check
  local aim check='{"reached":false}' tabs=0
  aim=$(inpage focus-ring "{\"step\":\"aim\",\"selector\":$1}") || exit 1
  if [ "$(jx 'A[0].tabbable ? "y" : ""' "$aim")" = y ]; then
    while [ "$tabs" -lt "$2" ]; do
      ab press Tab >/dev/null || exit 1
      tabs=$((tabs + 1))
      check=$(inpage focus-ring "{\"step\":\"check\",\"selector\":$1}") || exit 1
      [ "$(jx 'A[0].reached ? "y" : ""' "$check")" = y ] && break
    done
  fi
  jx 'Object.assign(A[0], { tabbable: A[1].tabbable, tabs: Number(A[2]) })' "$check" "$aim" "$tabs"
}

click_at() {  # click_at <x> <y>: a real click (mouse move, down, up) at viewport coordinates
  ab mouse move "$1" "$2" >/dev/null || exit 1
  ab mouse down left >/dev/null || exit 1
  ab mouse up left >/dev/null || exit 1
}

# --- focus-ring ---------------------------------------------------------------

focus_cleanup() {
  inpage focus-ring '{"step":"restore"}' >/dev/null
}

step_focus_ring() {
  local cfg list n i entry selj check res max focused unfocused
  cfg=$(jx 'focusConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  SHOTS=$(jx 'A[0].shots || ""' "$cfg") || exit 1
  max=$(jx 'A[0].maxTabs' "$cfg") || exit 1
  [ -z "$SHOTS" ] || mkdir -p "$SHOTS" || fail "cannot create $SHOTS"
  CLEANUP=focus_cleanup
  list=$(inpage focus-ring "$(jx 'JSON.stringify({ step: "list", controls: A[0].controls, scope: A[0].scope })' "$cfg")") || exit 1
  n=$(jx 'A[0].controls.length' "$list") || exit 1
  export UI_REVIEW_FOCUS="$TMP/focus.ndjson"
  : >"$UI_REVIEW_FOCUS"

  for ((i = 0; i < n; i++)); do
    entry=$(jx 'A[0].controls[Number(A[1])]' "$list" "$i") || exit 1
    selj=$(jx 'JSON.stringify(A[0].selector)' "$entry") || exit 1
    if [ "$(jx 'A[0].found && A[0].tabbable ? "y" : ""' "$entry")" != y ]; then
      jx 'fs.appendFileSync(process.env.UI_REVIEW_FOCUS, JSON.stringify(focusMissed(A[0], null)) + "\n"), ""' "$entry" || exit 1
      continue
    fi
    check=$(tab_to "$selj" "$max") || exit 1
    if [ "$(jx 'A[0].reached ? "y" : ""' "$check")" != y ]; then
      jx 'fs.appendFileSync(process.env.UI_REVIEW_FOCUS, JSON.stringify(focusMissed(A[0], A[1])) + "\n"), ""' "$entry" "$check" || exit 1
      continue
    fi
    focused="$TMP/focus-$i-focused.png"
    unfocused="$TMP/focus-$i-unfocused.png"
    ab screenshot "$focused" >/dev/null || exit 1
    res=$(inpage focus-ring "{\"step\":\"blur\",\"selector\":$selj}") || exit 1
    ab screenshot "$unfocused" >/dev/null || exit 1
    F="$focused" U="$unfocused" S="$SHOTS" jx 'fs.appendFileSync(process.env.UI_REVIEW_FOCUS, JSON.stringify(focusEntry(Number(A[0]), A[1], A[2], A[3],
      { focused: process.env.F, unfocused: process.env.U }, process.env.S || null)) + "\n"), ""' "$i" "$entry" "$check" "$res" 2>"$TMP/err" \
      || fail "crop diff for $(jx 'A[0].selector' "$entry"): $(cat "$TMP/err")"
  done

  focus_cleanup || exit 1
  CLEANUP=""
  jx 'focusReport(A[0], ndjson(process.env.UI_REVIEW_FOCUS))' "$cfg"
}

# --- hit-area -----------------------------------------------------------------

hit_cleanup() {
  inpage hit-area '{"step":"restore"}' >/dev/null
}

step_hit_area() {
  local cfg grid n i click x y after again final
  cfg=$(jx 'hitConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  CLEANUP=hit_cleanup
  grid=$(inpage hit-area "$(jx 'JSON.stringify(Object.assign({ step: "grid" }, A[0]))' "$cfg")") || exit 1
  n=$(jx 'A[0].clicks.length' "$grid") || exit 1
  export UI_REVIEW_HIT="$TMP/hit.ndjson"
  : >"$UI_REVIEW_HIT"

  for ((i = 0; i < n; i++)); do
    click=$(jx 'A[0].clicks[Number(A[1])]' "$grid" "$i") || exit 1
    x=$(jx 'A[0].x' "$click") || exit 1
    y=$(jx 'A[0].y' "$click") || exit 1
    click_at "$x" "$y"
    after=$(inpage hit-area '{"step":"state"}') || exit 1
    again=null
    if [ "$(jx 'A[0].state !== A[1].state ? "y" : ""' "$after" "$grid")" = y ]; then
      click_at "$x" "$y"  # it toggled: click again to restore it
      again=$(inpage hit-area '{"step":"state"}') || exit 1
    fi
    jx 'fs.appendFileSync(process.env.UI_REVIEW_HIT, JSON.stringify(hitClick(A[0], A[1], A[2], A[3])) + "\n"), ""' \
      "$click" "$grid" "$after" "$again" || exit 1
  done

  final=$(inpage hit-area '{"step":"restore"}') || exit 1
  CLEANUP=""
  jx 'hitReport(A[0], A[1], ndjson(process.env.UI_REVIEW_HIT), A[2])' "$cfg" "$grid" "$final"
}

# --- contrast -----------------------------------------------------------------

contrast_cleanup() {
  # shellcheck disable=SC2086 # "<scheme> [reduced-motion]" is two words on purpose
  [ -z "$MEDIA_RESTORE" ] || ab set media $MEDIA_RESTORE >/dev/null
  inpage focus-ring '{"step":"restore"}' >/dev/null
}

contrast_record() {  # contrast_record <measure-json> <theme> <state> [extra-json]: append each measurement
  THEME="$2" STATE="$3" jx 'A[0].measurements.forEach((m) => fs.appendFileSync(process.env.UI_REVIEW_CONTRAST,
    JSON.stringify(Object.assign({ selector: m.selector, theme: process.env.THEME, state: process.env.STATE }, A[1] || {}, m)) + "\n")), ""' \
    "$1" "${4:-null}" || exit 1
}

step_contrast() {
  local cfg media nt ns ng t s g theme state kind tname sname scheme motion target targetj all one meas check
  cfg=$(jx 'contrastConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  media=$(inpage contrast '{"step":"media"}') || exit 1
  MEDIA_RESTORE=""
  CLEANUP=contrast_cleanup
  nt=$(jx 'A[0].themes.length' "$cfg") || exit 1
  ns=$(jx 'A[0].states.length' "$cfg") || exit 1
  ng=$(jx 'A[0].targets.length' "$cfg") || exit 1
  all=$(jx 'JSON.stringify({ step: "measure", targets: A[0].targets })' "$cfg") || exit 1
  motion=$(jx 'A[0].reducedMotion ? "reduced-motion" : ""' "$media") || exit 1
  export UI_REVIEW_CONTRAST="$TMP/contrast.ndjson"
  : >"$UI_REVIEW_CONTRAST"

  for ((t = 0; t < nt; t++)); do
    theme=$(jx 'A[0].themes[Number(A[1])]' "$cfg" "$t") || exit 1
    tname=$(jx 'A[0].name' "$theme") || exit 1
    scheme=$(jx 'A[0].media || ""' "$theme") || exit 1
    if [ -n "$scheme" ]; then
      MEDIA_RESTORE=$(jx 'A[0].scheme + (A[0].reducedMotion ? " reduced-motion" : "")' "$media") || exit 1
      ab set media "$scheme" ${motion:+"$motion"} >/dev/null || exit 1
    fi
    if [ "$(jx 'A[0].cli || A[0].js ? "y" : ""' "$theme")" = y ]; then run_action "$theme"; fi

    for ((s = 0; s < ns; s++)); do
      state=$(jx 'A[0].states[Number(A[1])]' "$cfg" "$s") || exit 1
      sname=$(jx 'A[0].name' "$state") || exit 1
      kind=$(jx 'A[0].kind' "$state") || exit 1
      case "$kind" in
        default | action)
          if [ "$kind" = default ]; then
            inpage contrast '{"step":"rest"}' >/dev/null || exit 1
            ab mouse move 0 0 >/dev/null || exit 1
          else
            run_action "$state"
          fi
          meas=$(inpage contrast "$all") || exit 1
          contrast_record "$meas" "$tname" "$sname"
          ;;
        hover | focus)
          for ((g = 0; g < ng; g++)); do
            target=$(jx 'A[0].targets[Number(A[1])]' "$cfg" "$g") || exit 1
            targetj=$(jx 'JSON.stringify(A[0].targets[Number(A[1])])' "$cfg" "$g") || exit 1
            one="{\"step\":\"measure\",\"targets\":[$targetj]}"
            if [ "$kind" = hover ]; then
              ab hover "$target" >/dev/null || exit 1
              meas=$(inpage contrast "$one") || exit 1
              contrast_record "$meas" "$tname" "$sname"
            else
              check=$(tab_to "$targetj" "$(jx 'A[0].maxTabs' "$cfg")") || exit 1
              if [ "$(jx 'A[0].reached ? "y" : ""' "$check")" = y ]; then
                meas=$(inpage contrast "$one") || exit 1
                contrast_record "$meas" "$tname" "$sname" '{"reached":true}'
              else
                contrast_record "{\"measurements\":[{\"selector\":$targetj}]}" "$tname" "$sname" \
                  "$(jx 'JSON.stringify({ reached: false, tabbable: A[0].tabbable })' "$check")"
              fi
            fi
          done
          ;;
      esac
    done
  done

  contrast_cleanup || exit 1
  CLEANUP=""
  jx '({ probe: "contrast", targets: A[0].targets, states: A[0].states.map((s) => s.name), themes: A[0].themes.map((t) => t.name),
    measurements: ndjson(process.env.UI_REVIEW_CONTRAST) })' "$cfg"
}

# --- layout-jump --------------------------------------------------------------

jump_cleanup() {
  inpage layout-jump '{"step":"restore"}' >/dev/null
}

step_layout_jump() {
  local cfg out
  cfg=$(jx 'jumpConfig(parseArgs(A[0]))' "$ARGS" 2>"$TMP/err") || fail "$(cat "$TMP/err")"
  CLEANUP=jump_cleanup
  inpage layout-jump "$(jx 'JSON.stringify({ step: "install", watch: A[0].watch })' "$cfg")" >/dev/null || exit 1
  run_action "$(jx 'JSON.stringify(A[0].action)' "$cfg")"
  out=$(inpage layout-jump "$(jx 'JSON.stringify({ step: "read", settleMs: A[0].settleMs })' "$cfg")") || exit 1
  CLEANUP=""
  jx 'Object.assign({ probe: "layout-jump", action: A[0].action, watch: A[0].watch }, A[1])' "$cfg" "$out"
}

# --- main ---------------------------------------------------------------------

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
      if [ -z "$PROBE" ]; then PROBE=$1
      elif [ -z "$ARGS" ]; then ARGS=$1
      else fail "unexpected argument: $1"
      fi
      shift
      ;;
  esac
done
[ -n "$ARGS" ] || ARGS='{}'

case "$PROBE" in
  "" | *[!a-z0-9-]*)
    fail "usage: bash probe.sh <probe> '<json-args>' [--session <name>]; probes: $(cd "$PROBES" && ls *.js 2>/dev/null | sed 's/\.js$//' | tr '\n' ' ')"
    ;;
esac
command -v node >/dev/null 2>&1 || fail "node is required (it parses the JSON arguments)"
command -v agent-browser >/dev/null 2>&1 || fail "agent-browser is not on PATH"
[ -f "$PROBES/$PROBE.js" ] || fail "unknown probe $PROBE; probes: $(cd "$PROBES" && ls *.js 2>/dev/null | sed 's/\.js$//' | tr '\n' ' ')"
jx 'parseArgs(A[0]), ""' "$ARGS" 2>"$TMP/err" >/dev/null || fail "bad args: $(cat "$TMP/err")"

# The step runs in this shell (not a subshell), so its CLEANUP reaches the EXIT
# trap; its only stdout is the final document.
step="step_$(printf '%s' "$PROBE" | tr '-' '_')"
if declare -F "$step" >/dev/null; then
  "$step" || exit 1
else
  inpage "$PROBE" "$ARGS" \
    "isObj(R) ? JSON.stringify(Object.assign({ probe: '$PROBE' }, R)) : (() => { throw new Error('$PROBE must return a plain object') })()" \
    || exit 1
fi
printf '\n'
