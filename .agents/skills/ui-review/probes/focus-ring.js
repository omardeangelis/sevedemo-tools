// focus-ring, in-page half (corrects recipe R-RING). For each control scripts/probe.sh
// runs "aim", one real `press Tab` (more, up to maxTabs, while "check" says the Tab has
// not arrived), a screenshot, "blur", a second screenshot; it crops both to the returned
// `crop` rect and compares them in node. `focus <sel>` is never used: it paints no
// :focus-visible ring.
//   {step: "list", controls, scope}  the controls to visit: the listed selectors, else every
//                                    tabbable control inside scope (default body), in Tab order
//   {step: "aim", selector}          focus the control before it in Tab order (or the document
//                                    start), so the next real Tab lands on it
//   {step: "check", selector}        did the Tab reach it, with :focus-visible; when it did,
//                                    record the ring candidates while focused
//   {step: "blur", selector}         document.activeElement.blur() (focus moves to BODY, so no
//                                    neighbour paints a ring in the crop), then read the same
//                                    candidates unfocused and return the ring report
//   {step: "restore"}                drop the probe's state
// Ring geometry, per candidate: the outline counts only when outline-style is not none
// (Chromium reports a width even with outline: none); otherwise the non-inset box-shadows with
// a spread; otherwise no ring. The candidates are the control, then its labels and ancestors:
// when the control draws no ring, the first of them whose ring appears only with focus (a row
// outlined through :has(:focus-visible) or :focus-within) owns it.
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const KEY = '__uiReviewFocusRing';
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const px = (v) => parseFloat(v) || 0;
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const grow = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });
  const union = (a, b) => (!a ? b : !b ? a : {
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)
  });
  const meet = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const inter = (a, b) => {
    if (!a || !b) return null;
    const r = meet(a, b);
    return r.right > r.left && r.bottom > r.top ? r : null;
  };
  const area = (r) => (r ? (r.right - r.left) * (r.bottom - r.top) : 0);
  const empty = (r) => r.right - r.left <= 0 || r.bottom - r.top <= 0;
  const contains = (outer, inner, slack) => inner.left >= outer.left - slack && inner.top >= outer.top - slack &&
    inner.right <= outer.right + slack && inner.bottom <= outer.bottom + slack;
  const rect = (r) => (r ? { x: round(r.left), y: round(r.top), width: round(r.right - r.left), height: round(r.bottom - r.top), right: round(r.right), bottom: round(r.bottom) } : null);

  // A selector that finds the element again: its id when unique, else a short tag/class/nth-of-type path.
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { parts.unshift('#' + CSS.escape(n.id)); break; }
      if (n === document.body || n === document.documentElement) { parts.unshift(n.localName); break; }
      let part = n.localName + [...n.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const must = (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error('focus-ring: control not found: ' + selector);
    return el;
  };

  // Sequential focus order: positive tabindex first, then document order.
  const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls]';
  const tabbable = (el) => {
    if (el.tabIndex < 0 || el.disabled || el.closest('[inert]') || !el.getClientRects().length) return false;
    if (getComputedStyle(el).visibility !== 'visible') return false;
    return !(el.localName === 'summary' && el.parentElement?.localName === 'details' && el.parentElement.querySelector(':scope > summary') !== el);
  };
  const tabOrder = () => {
    const all = [...document.querySelectorAll(FOCUSABLE)].filter(tabbable);
    return all.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex).concat(all.filter((e) => e.tabIndex === 0));
  };
  const restoreBody = () => {
    const st = window[KEY];
    if (st && 'bodyTabindex' in st) {
      if (st.bodyTabindex === null) document.body.removeAttribute('tabindex');
      else document.body.setAttribute('tabindex', st.bodyTabindex);
      delete st.bodyTabindex;
    }
  };

  // The ring a node paints now, and a signature of the styles that draw it.
  const signature = (node) => {
    const s = getComputedStyle(node);
    return [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor, s.boxShadow].join('|');
  };
  const shadows = (value) => {
    if (!value || value === 'none') return [];
    const list = [];
    let depth = 0, cur = '';
    for (const ch of value) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { list.push(cur); cur = ''; } else cur += ch;
    }
    list.push(cur);
    return list.map((s) => {
      const color = (s.match(/rgba?\([^)]*\)/) || [''])[0];
      const lengths = s.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || [];
      const alphaMatch = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      return {
        inset: /\binset\b/.test(s), color,
        alpha: color ? (alphaMatch ? parseFloat(alphaMatch[1]) : 1) : 1,
        x: px(lengths[0]), y: px(lengths[1]), blur: px(lengths[2]), spread: px(lengths[3])
      };
    });
  };
  const ringOf = (node) => {
    const s = getComputedStyle(node), r = box(node);
    if (s.outlineStyle !== 'none' && px(s.outlineWidth) > 0) {
      const width = px(s.outlineWidth), offset = px(s.outlineOffset);
      return { kind: 'outline', width, offset, outer: grow(r, offset + width), inner: grow(r, offset), style: s.outlineStyle, color: s.outlineColor };
    }
    const spread = shadows(s.boxShadow).filter((sh) => !sh.inset && sh.spread > 0 && sh.alpha > 0);
    if (spread.length) {
      const outer = spread.map((sh) => {
        const g = grow(r, sh.spread);
        return { left: g.left + sh.x, top: g.top + sh.y, right: g.right + sh.x, bottom: g.bottom + sh.y };
      }).reduce(union);
      return { kind: 'box-shadow', width: Math.max(...spread.map((sh) => sh.spread)), offset: 0, outer, inner: r, color: spread[spread.length - 1].color };
    }
    return null;
  };

  // Ancestors that clip the node's ring: overflow other than visible, or contain: paint. An
  // absolutely positioned subtree escapes ancestors up to its containing block; a fixed one escapes
  // every ancestor that is not a containing block for it (transform, filter, perspective, contain).
  const clippers = (node) => {
    const out = [];
    let mode = getComputedStyle(node).position;
    for (let a = node.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const holdsFixed = s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none' || /paint|layout|strict|content/.test(s.contain);
      let applies = true;
      if (mode === 'fixed') applies = holdsFixed;
      else if (mode === 'absolute') applies = s.position !== 'static' || holdsFixed;
      if (!applies) continue;
      mode = s.position === 'absolute' || s.position === 'fixed' ? s.position : 'static';
      const paint = /paint|strict|content/.test(s.contain);
      const clipX = paint || s.overflowX !== 'visible', clipY = paint || s.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const b = box(a);
      out.push({
        el: a,
        rect: {
          left: clipX ? b.left + px(s.borderLeftWidth) : -Infinity,
          top: clipY ? b.top + px(s.borderTopWidth) : -Infinity,
          right: clipX ? b.right - px(s.borderRightWidth) : Infinity,
          bottom: clipY ? b.bottom - px(s.borderBottomWidth) : Infinity
        }
      });
    }
    return out;
  };
  const cut = (outer, clip) => ({
    left: Math.max(0, clip.left - outer.left), top: Math.max(0, clip.top - outer.top),
    right: Math.max(0, outer.right - clip.right), bottom: Math.max(0, outer.bottom - clip.bottom)
  });

  // Points on the visible part of the ring band, 2 px apart: a point whose topmost element sits in a
  // fixed or sticky layer that is not the control's own counts as obscured. Pointer-events: none
  // layers are invisible to elementFromPoint.
  const obscured = (ring, visible, node) => {
    const layerOf = new Map();
    const layer = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        if (layerOf.has(n)) return layerOf.get(n);
        const p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') { layerOf.set(n, n); return n; }
      }
      return null;
    };
    const outer = ring.outer, hole = inter(ring.inner, outer);
    let total = 0, hidden = 0;
    const by = new Map();
    for (let y = outer.top + 1; y < outer.bottom; y += 2) {
      for (let x = outer.left + 1; x < outer.right; x += 2) {
        if (hole && x >= hole.left && x < hole.right && y >= hole.top && y < hole.bottom) continue;
        if (visible && (x < visible.left || x >= visible.right || y < visible.top || y >= visible.bottom)) continue;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        total += 1;
        const hit = document.elementFromPoint(x, y);
        const l = hit && layer(hit);
        if (l && !l.contains(node) && !node.contains(l)) { hidden += 1; by.set(l, (by.get(l) || 0) + 1); }
      }
    }
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return { fraction: total ? round(hidden / total) : 0, by: top ? cssPath(top[0]) : null };
  };

  if (args.step === 'list') {
    const order = tabOrder();
    if (args.controls) {
      return {
        controls: args.controls.map((selector) => {
          const el = document.querySelector(selector);
          return { selector, found: !!el, tabbable: !!el && order.includes(el) };
        })
      };
    }
    const scope = document.querySelector(args.scope || 'body');
    if (!scope) throw new Error('focus-ring: scope not found: ' + args.scope);
    return { controls: order.filter((el) => scope.contains(el)).map((el) => ({ selector: cssPath(el), found: true, tabbable: true })) };
  }

  if (args.step === 'aim') {
    const el = must(args.selector);
    const order = tabOrder(), i = order.indexOf(el);
    restoreBody();
    window[KEY] = {};
    if (i < 0) return { tabbable: false };
    if (i > 0) {
      order[i - 1].focus({ preventScroll: true });
    } else {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      window[KEY].bodyTabindex = document.body.getAttribute('tabindex');
      document.body.setAttribute('tabindex', '-1');
      document.body.focus({ preventScroll: true });
    }
    return { tabbable: true, from: i > 0 ? cssPath(order[i - 1]) : 'document start' };
  }

  if (args.step === 'check') {
    const el = must(args.selector);
    const active = document.activeElement;
    if (active !== document.body) restoreBody();
    if (active !== el) {
      return { reached: false, active: active && active !== document.body ? cssPath(active) : active ? active.localName : null };
    }
    // Tab scrolls the control just into view; centre it when it sits within 16 px of an edge, so
    // the crops hold the whole ring.
    const b = el.getBoundingClientRect();
    if (b.top < 16 || b.left < 16 || b.bottom > innerHeight - 16 || b.right > innerWidth - 16) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    await frame();
    const chain = [el];
    for (const l of el.labels || []) if (!chain.includes(l)) chain.push(l);
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (!chain.includes(a)) chain.push(a);
    window[KEY] = { el, chain, focused: chain.map(signature), rings: chain.map(ringOf) };
    return { reached: true, focusVisible: el.matches(':focus-visible') };
  }

  if (args.step === 'blur') {
    const st = window[KEY];
    if (!st || !st.el) throw new Error('focus-ring: blur before a successful check');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    await frame();
    await frame();
    const { el, chain, rings, focused } = st;
    const now = chain.map(signature);
    const owner = rings[0] ? 0 : chain.findIndex((n, i) => i > 0 && rings[i] && focused[i] !== now[i]);
    const elBox = box(el);
    const target = [el, ...(el.labels || [])].map(box).filter((r) => !empty(r)).reduce(union, null) || elBox;
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const base = {
      active: document.activeElement ? document.activeElement.localName : null,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      target: rect(target)
    };
    if (owner < 0) {
      return Object.assign(base, {
        ringKind: 'none', ringOwner: null, ring: null, ringWidth: 0, changesOnFocus: false,
        clips: clippers(el).map((c) => cssPath(c.el)), clipAncestor: null, clippedPx: null, clippedFraction: null,
        obscuredFraction: null, obscuredBy: null, enclosesTarget: false,
        crop: rect(inter(grow(elBox, 8), viewport))
      });
    }
    const node = chain[owner], ring = rings[owner];
    const clips = clippers(node);
    const visible = clips.reduce((v, c) => meet(v, c.rect), { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
    const sides = cut(ring.outer, visible);
    const cutter = clips.find((c) => Object.values(cut(ring.outer, c.rect)).some((v) => v > 0.5));
    const hole = inter(ring.inner, ring.outer);
    const band = area(ring.outer) - area(hole);
    const shown = area(inter(ring.outer, visible)) - area(inter(hole, visible));
    const cover = obscured(ring, visible, node);
    const slack = 0.5 + (ring.kind === 'outline' ? Math.max(0, -ring.offset) : 0);
    const crop = cutter ? box(cutter.el) : grow(union(elBox, ring.outer), 8);
    return Object.assign(base, {
      ringKind: ring.kind,
      ringOwner: cssPath(node),
      ring: rect(ring.outer),
      ringWidth: round(ring.width),
      ringStyle: ring.kind === 'outline' ? ring.style + ' ' + round(ring.width) + 'px offset ' + round(ring.offset) + 'px ' + ring.color : 'box-shadow ' + ring.color,
      changesOnFocus: focused[owner] !== now[owner],
      clips: clips.map((c) => cssPath(c.el)),
      clipAncestor: cutter ? cssPath(cutter.el) : null,
      clippedPx: { left: round(sides.left), top: round(sides.top), right: round(sides.right), bottom: round(sides.bottom) },
      clippedFraction: band > 0 ? round(Math.min(1, Math.max(0, (band - shown) / band))) : 0,
      obscuredFraction: cover.fraction,
      obscuredBy: cover.by,
      enclosesTarget: contains(ring.outer, target, slack),
      crop: rect(inter(crop, viewport))
    });
  }

  if (args.step === 'restore') {
    restoreBody();
    delete window[KEY];
    return { restored: true };
  }

  throw new Error('focus-ring: unknown step ' + JSON.stringify(args.step));
}
