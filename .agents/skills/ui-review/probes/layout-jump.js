// layout-jump, in-page half (recipe R-JUMP). scripts/probe.sh calls "install", runs the
// caller's action (an agent-browser subcommand or a page expression), then "read":
//   {step: "install", watch}   start a layout-shift observer and a per-frame log of the
//                              running animations; record the watched elements' boxes
//   {step: "read", settleMs}   wait settleMs, flush the observer, stop both, and return every
//                              shift with `animating`, plus each watched box before, after
//                              and the delta
//   {step: "restore"}          stop observing (the runner's cleanup on failure)
// A shift is `animating` when an animation or transition ran at its time on an element that
// contains one of its sources, sits inside one, or, for an animation of a layout property
// (height, width, margin, padding, inset, ...), is a sibling subtree it displaces (its parent
// contains the source). An unrelated animation elsewhere, such as a spinner, does not count;
// it is listed under runningElsewhere. A shift during a related animation is motion, not UI.
// Limit: the layout-shift API reports nothing for transform or opacity animations, so "no
// shift" does not prove "no motion".
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const KEY = '__uiReviewLayoutJump';
  const TOLERANCE = 50; // ms around an animation's observed run that still counts as "during"
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const rect = (r) => (r ? { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) } : null);
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
  const boxes = (watch) => watch.map((selector) => {
    const el = document.querySelector(selector);
    return { selector, box: el ? rect(el.getBoundingClientRect()) : null };
  });
  // Properties whose animation moves other boxes; transform, opacity, colour and filters do not.
  const NON_LAYOUT = /^(transform|translate|rotate|scale|opacity|color|background.*|border-.*-color|outline.*|box-shadow|text-shadow|filter|backdrop-filter|clip-path|visibility|fill|stroke.*|offset.*|all-paint)$/;
  const animatedProps = (a) => {
    if (a.transitionProperty) return [a.transitionProperty];
    try {
      const keys = new Set();
      for (const kf of a.effect.getKeyframes()) {
        for (const k of Object.keys(kf)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) keys.add(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
      }
      return [...keys];
    } catch {
      return [];
    }
  };

  if (args.step === 'install') {
    const old = window[KEY];
    if (old) { old.observer.disconnect(); old.running = false; }
    const supported = (PerformanceObserver.supportedEntryTypes || []).includes('layout-shift');
    const st = window[KEY] = { entries: [], seen: new Map(), running: true, start: performance.now(), before: boxes(args.watch || []), watch: args.watch || [] };
    const log = () => {
      const now = performance.now();
      for (const a of document.getAnimations()) {
        if (a.playState !== 'running' || !a.effect || !a.effect.target) continue;
        let rec = st.seen.get(a);
        if (!rec) {
          const props = animatedProps(a);
          rec = {
            target: a.effect.target,
            name: a.animationName || a.transitionProperty || a.id || a.constructor.name,
            type: a.constructor.name,
            layout: props.some((p) => !NON_LAYOUT.test(p)),
            from: now,
            to: now
          };
          st.seen.set(a, rec);
          a.addEventListener('finish', () => { rec.to = Math.max(rec.to, performance.now()); }, { once: true });
          a.addEventListener('cancel', () => { rec.to = Math.max(rec.to, performance.now()); }, { once: true });
        }
        rec.to = now;
      }
    };
    const take = (list) => {
      log();
      for (const e of list) {
        st.entries.push({
          value: e.value,
          hadRecentInput: e.hadRecentInput,
          startTime: e.startTime,
          sources: (e.sources || []).map((s) => ({ node: s.node && s.node.nodeType === 1 ? s.node : s.node ? s.node.parentElement : null, previous: s.previousRect, current: s.currentRect }))
        });
      }
    };
    st.take = take;
    st.observer = new PerformanceObserver((list) => take(list.getEntries()));
    if (supported) st.observer.observe({ type: 'layout-shift' });
    const tick = () => { if (!st.running) return; log(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    log();
    return { supported, before: st.before };
  }

  if (args.step === 'read') {
    const st = window[KEY];
    if (!st) throw new Error('layout-jump: read before install (a navigation or reload in the action drops the observer)');
    const settle = args.settleMs ?? 600;
    await new Promise((resolve) => setTimeout(resolve, settle));
    await frame();
    await frame();
    st.take(st.observer.takeRecords());
    st.observer.disconnect();
    st.running = false;
    delete window[KEY];

    const animations = [...st.seen.values()];
    const related = (rec, node) => node && (rec.target.contains(node) || node.contains(rec.target) ||
      (rec.layout && rec.target.parentElement && rec.target.parentElement.contains(node)));
    const used = new Set();
    const shifts = st.entries.map((e) => {
      const during = animations.filter((rec) => e.startTime >= rec.from - TOLERANCE && e.startTime <= rec.to + TOLERANCE &&
        e.sources.some((s) => related(rec, s.node)));
      during.forEach((rec) => used.add(rec));
      return {
        at: round(e.startTime - st.start),
        value: Math.round(e.value * 1e6) / 1e6,
        hadRecentInput: e.hadRecentInput,
        animating: during.length > 0,
        animations: during.map((rec) => ({ name: rec.name, type: rec.type, target: cssPath(rec.target) })),
        sources: e.sources.map((s) => ({
          node: s.node ? (s.node.isConnected ? cssPath(s.node) : '(removed) ' + s.node.localName) : null,
          dx: round(s.current.x - s.previous.x),
          dy: round(s.current.y - s.previous.y),
          dw: round(s.current.width - s.previous.width),
          dh: round(s.current.height - s.previous.height)
        }))
      };
    });
    const after = boxes(st.watch);
    return {
      settleMs: settle,
      shifts,
      instant: shifts.filter((s) => !s.animating).length,
      animated: shifts.filter((s) => s.animating).length,
      boxes: st.before.map((b, i) => ({
        selector: b.selector,
        before: b.box,
        after: after[i].box,
        delta: b.box && after[i].box ? {
          x: round(after[i].box.x - b.box.x), y: round(after[i].box.y - b.box.y),
          width: round(after[i].box.width - b.box.width), height: round(after[i].box.height - b.box.height)
        } : null
      })),
      runningElsewhere: animations.filter((rec) => !used.has(rec)).map((rec) => ({ name: rec.name, type: rec.type, target: cssPath(rec.target) }))
    };
  }

  if (args.step === 'restore') {
    const st = window[KEY];
    if (st) { st.observer.disconnect(); st.running = false; }
    delete window[KEY];
    return { restored: !!st };
  }

  throw new Error('layout-jump: unknown step ' + JSON.stringify(args.step));
}
