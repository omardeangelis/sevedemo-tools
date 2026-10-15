// contrast, in-page half. scripts/probe.sh puts the page in each theme and state (media,
// hover, a real Tab for focus, or the caller's own action), then calls "measure":
//   {step: "measure", targets}  per target: the text colour against the composited background,
//                               the WCAG 2.2 ratio and the ratio 1.4.3 requires
//   {step: "media"}             the current prefers-color-scheme and reduced-motion, so the
//                               runner can restore them
//   {step: "rest"}              blur the focused element (the default state)
// The background is composited by walking the ancestors from the element up and blending each
// translucent background-color over the next, until an opaque one (else the canvas: white, or
// Chromium's dark canvas when the root's color-scheme resolves to dark). `get styles` reports only
// the element's own background, often transparent. A background image or gradient, opacity,
// filter, backdrop-filter, blend mode or text shadow on the way makes the result `needsReview`:
// the ratio is then computed over the colour layers only.
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const parse = (value) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(value || '');
    if (!m) return null;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1
  });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') +
    (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');
  const luminance = (c) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };
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
  const canvas = () => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    const scheme = (getComputedStyle(document.documentElement).colorScheme || 'normal') + ' ' + (meta ? meta.content : '');
    const dark = /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  };

  const measure = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, found: false };
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const reasons = new Set();
    const layers = [];
    let backdrop = null;
    for (let a = el; a; a = a.parentElement) {
      const s = a === el ? cs : getComputedStyle(a);
      if (parseFloat(s.opacity) < 1) reasons.add('opacity');
      if (s.filter && s.filter !== 'none') reasons.add('filter');
      if (s.backdropFilter && s.backdropFilter !== 'none') reasons.add('backdrop-filter');
      if (s.mixBlendMode && s.mixBlendMode !== 'normal') reasons.add('blend-mode');
      if (s.backgroundImage && s.backgroundImage !== 'none') reasons.add(/gradient\(/.test(s.backgroundImage) ? 'gradient' : 'image');
      const bg = parse(s.backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a >= 1) { backdrop = a; break; }
    }
    if (cs.textShadow && cs.textShadow !== 'none') reasons.add('text-shadow');
    const bottom = backdrop ? layers.pop() : canvas();
    const background = layers.reverse().reduce((under, top) => over(top, under), bottom);
    const ink = parse(cs.webkitTextFillColor) || parse(cs.color);
    const text = ink.a < 1 ? over(ink, background) : ink;
    const [hi, lo] = [luminance(text), luminance(background)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    return {
      selector,
      found: true,
      visible: r.width > 0 && r.height > 0 && cs.visibility === 'visible',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      color: hex(ink),
      background: hex(background),
      backgroundFrom: backdrop ? cssPath(backdrop) : 'canvas',
      ratio: round(ratio),
      fontSizePx: round(size),
      fontWeight: weight,
      large,
      required,
      passes: ratio >= required,
      needsReview: reasons.size > 0,
      reasons: [...reasons]
    };
  };

  if (args.step === 'measure') {
    await frame();
    await frame();
    return { measurements: args.targets.map(measure) };
  }

  if (args.step === 'media') {
    return {
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    };
  }

  if (args.step === 'rest') {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    await frame();
    return { active: document.activeElement ? document.activeElement.localName : null };
  }

  throw new Error('contrast: unknown step ' + JSON.stringify(args.step));
}
