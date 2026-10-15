// hit-area, in-page half (corrects recipe R-HIT). scripts/probe.sh calls "grid", then
// clicks each returned point with real `mouse move/down/up` and calls "state" after each
// click (clicking again where the state toggled), then "restore":
//   {step: "grid", control, hover, gridStep, clicks}
//       scroll the hover box (what looks clickable: the element that highlights) into view
//       and sample elementFromPoint on a gridStep grid over it, with no clicks. A point
//       responds when it hits the control, one of its <label>s, or a descendant of either.
//       Counts the control's click events from here on, and returns the coverage, the
//       responding box (the control and the labels the grid hit) and at most `clicks`
//       points to confirm: the box centre, points inside and outside the responding region
//   {step: "state"}    the control's state and the click events it received since the last read
//   {step: "restore"}  stop counting
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const KEY = '__uiReviewHitArea';
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const union = (a, b) => (!a ? b : !b ? a : {
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)
  });
  const rect = (r) => (r ? { x: round(r.left), y: round(r.top), width: round(r.right - r.left), height: round(r.bottom - r.top), right: round(r.right), bottom: round(r.bottom) } : null);
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
  // What a click can change on the control: checked state, ARIA state, <details> open.
  const stateOf = (el) => JSON.stringify([
    'checked' in el ? el.checked : null,
    'indeterminate' in el ? el.indeterminate : null,
    ...['aria-checked', 'aria-pressed', 'aria-expanded', 'aria-selected'].map((a) => el.getAttribute(a)),
    el.closest('details') ? el.closest('details').open : null
  ]);

  if (args.step === 'grid') {
    const control = document.querySelector(args.control);
    if (!control) throw new Error('hit-area: control not found: ' + args.control);
    const hover = document.querySelector(args.hover || args.control);
    if (!hover) throw new Error('hit-area: hover box not found: ' + args.hover);
    hover.scrollIntoView({ block: 'center', inline: 'nearest' });
    await frame();
    await frame();

    const roots = [control, ...(control.labels || [])];
    const rootAt = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit ? roots.find((r) => r === hit || r.contains(hit)) || null : null;
    };
    const hb = box(hover), step = args.gridStep || 4;
    const points = [];
    let offscreen = 0;
    for (let y = hb.top + step / 2; y < hb.bottom; y += step) {
      for (let x = hb.left + step / 2; x < hb.right; x += step) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { offscreen += 1; continue; }
        points.push({ x, y, root: rootAt(x, y) });
      }
    }
    const inside = points.filter((p) => p.root), outside = points.filter((p) => !p.root);
    const hitRoots = [...new Set(inside.map((p) => p.root))];
    const rb = hitRoots.map(box).reduce(union, null);

    // At most `clicks` points: the box centre, the responding box centre, four outside points
    // (nearest each edge of the hover box) and two inside points (nearest the responding box's sides).
    const cx = (hb.left + hb.right) / 2, cy = (hb.top + hb.bottom) / 2;
    const nearest = (list, tx, ty) => list.reduce((best, p) =>
      !best || (p.x - tx) ** 2 + (p.y - ty) ** 2 < (best.x - tx) ** 2 + (best.y - ty) ** 2 ? p : best, null);
    const picks = [{ where: 'centre', x: cx, y: cy }];
    if (rb) picks.push(Object.assign({ where: 'inside' }, nearest(inside, (rb.left + rb.right) / 2, (rb.top + rb.bottom) / 2)));
    for (const [tx, ty] of [[hb.left, cy], [hb.right, cy], [cx, hb.top], [cx, hb.bottom]]) {
      if (outside.length) picks.push(Object.assign({ where: 'outside' }, nearest(outside, tx, ty)));
    }
    if (rb) for (const tx of [rb.left, rb.right]) picks.push(Object.assign({ where: 'inside' }, nearest(inside, tx, (rb.top + rb.bottom) / 2)));
    const seen = new Set();
    const clicks = [];
    for (const p of picks) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (seen.has(x + ',' + y) || clicks.length >= (args.clicks ?? 8)) continue;
      seen.add(x + ',' + y);
      clicks.push({ x, y, where: p.where, expected: !!rootAt(x, y) });
    }

    const st = window[KEY] = { control, clicks: 0, listener: () => { st.clicks += 1; } };
    control.addEventListener('click', st.listener, true);
    const standard = args.standard ?? 24;
    return {
      hoverBox: rect(hb),
      gridStep: step,
      points: points.length,
      offscreenPoints: offscreen,
      respondingPoints: inside.length,
      coverage: points.length ? Math.round((inside.length / points.length) * 1000) / 1000 : 0,
      respondingBox: rect(rb),
      respondingSize: rb ? { width: round(rb.right - rb.left), height: round(rb.bottom - rb.top) } : null,
      respondingElements: hitRoots.map(cssPath),
      standard,
      meetsStandard: !!rb && rb.right - rb.left >= standard && rb.bottom - rb.top >= standard,
      clicks,
      state: stateOf(control)
    };
  }

  if (args.step === 'state') {
    const st = window[KEY];
    if (!st) throw new Error('hit-area: state before grid');
    await frame();
    const clicks = st.clicks;
    st.clicks = 0;
    return { state: stateOf(st.control), clicks };
  }

  if (args.step === 'restore') {
    const st = window[KEY];
    if (st) st.control.removeEventListener('click', st.listener, true);
    delete window[KEY];
    return { state: st ? stateOf(st.control) : null };
  }

  throw new Error('hit-area: unknown step ' + JSON.stringify(args.step));
}
