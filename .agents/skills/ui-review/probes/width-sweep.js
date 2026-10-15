// width-sweep, in-page half (recipe R-SWEEP). scripts/probe.sh sets each
// viewport width and calls this function with one step:
//   {step: "init"}                     viewport, root font size, and the width
//                                      breakpoints of the stylesheets' media queries
//   {step: "scale", scale}             root font size set to scale x its original value
//   {step: "restore"}                  root font size override removed
//   {step: "measure", targets, settle} per target: rows of its children, its own
//                                      width, horizontal overflow, and a box signature
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const root = document.documentElement;
  const KEY = '__uiReviewSweep';
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const rootFont = () => parseFloat(getComputedStyle(root).fontSize);

  if (args.step === 'init') {
    // Media-query widths in px. em and rem resolve against the initial font size (16 px).
    const found = new Set();
    let unreadableSheets = 0;
    const px = (n, unit) => Math.round(unit === 'px' ? n : n * 16);
    const scan = (text) => {
      for (const m of text.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|r?em)/g)) found.add(px(+m[1], m[2]));
      for (const m of text.matchAll(/(?:^|[(\s])width\s*(?:<=|>=|<|>)\s*([\d.]+)(px|r?em)/g)) found.add(px(+m[1], m[2]));
      for (const m of text.matchAll(/([\d.]+)(px|r?em)\s*(?:<=|>=|<|>)\s*width/g)) found.add(px(+m[1], m[2]));
    };
    const visit = (sheet) => {
      if (sheet.media) scan(sheet.media.mediaText);
      let rules;
      try { rules = sheet.cssRules; } catch { unreadableSheets += 1; return; }
      walk(rules);
    };
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.media) scan(rule.media.mediaText);
        if (rule.styleSheet) visit(rule.styleSheet);
        else if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet);
    return {
      width: innerWidth,
      height: innerHeight,
      rootFontPx: rootFont(),
      breakpoints: [...found].filter((w) => w > 0).sort((a, b) => a - b),
      unreadableSheets
    };
  }

  if (args.step === 'scale') {
    if (!window[KEY]) {
      window[KEY] = {
        value: root.style.getPropertyValue('font-size'),
        priority: root.style.getPropertyPriority('font-size'),
        base: rootFont()
      };
    }
    root.style.setProperty('font-size', window[KEY].base * args.scale + 'px', 'important');
    await frame();
    await frame();
    return { fontScale: args.scale, rootFontPx: rootFont() };
  }

  if (args.step === 'restore') {
    const saved = window[KEY];
    if (saved) {
      if (saved.value) root.style.setProperty('font-size', saved.value, saved.priority);
      else root.style.removeProperty('font-size');
      delete window[KEY];
    }
    return { rootFontPx: rootFont() };
  }

  if (args.step === 'measure') {
    if (args.settle) await new Promise((resolve) => setTimeout(resolve, args.settle));
    await frame();
    await frame();
    // Let finite transitions or animations that the width change started finish (1 s cap).
    const running = args.targets
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .flatMap((el) => el.getAnimations({ subtree: true }))
      .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    if (running.length) {
      await Promise.race([Promise.allSettled(running.map((a) => a.finished)), new Promise((r) => setTimeout(r, 1000))]);
      await frame();
    }
    const pageWidth = root.clientWidth;
    const targets = args.targets.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, found: false, rows: 0, containerWidth: 0, overflowX: false, sig: 'missing' };
      const box = el.getBoundingClientRect();
      // Rows: rendered children grouped by vertical overlap, top to bottom.
      const kids = [...el.children]
        .map((child) => child.getBoundingClientRect())
        .filter((r) => r.width > 0 || r.height > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left);
      const lines = [];
      for (const r of kids) {
        const line = lines[lines.length - 1];
        if (line && r.top < line.bottom - 0.5) { line.bottom = Math.max(line.bottom, r.bottom); line.count += 1; }
        else lines.push({ bottom: r.bottom, count: 1 });
      }
      const overflowX = el.scrollWidth > el.clientWidth + 1 || box.right > pageWidth + 0.5 || box.left < -0.5;
      return {
        selector,
        found: true,
        rows: lines.length,
        containerWidth: round(box.width),
        overflowX,
        // Box signature: children per row, plus overflow. It changes when any child moves row.
        sig: lines.map((l) => l.count).join('+') + (overflowX ? '!' : '')
      };
    });
    return { width: innerWidth, rootFontPx: rootFont(), sig: targets.map((t) => t.sig).join('|'), targets };
  }

  throw new Error('width-sweep: unknown step ' + JSON.stringify(args.step));
}
