// edge, in-page half (recipe R-EDGE). For each placement scripts/probe.sh
// reloads, calls the "place" step, clicks the trigger with agent-browser, then
// calls the "measure" step:
//   {step: "place", trigger, placement, inset}  scroll (inner scrollers first, then the
//                                               page) so the trigger sits at the top,
//                                               middle or bottom of the viewport
//   {step: "measure", trigger, overlay, settle} the overlay's box and its distance to
//                                               each viewport edge (negative = past it)
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  const box = (r) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) });
  const trigger = document.querySelector(args.trigger);
  if (!trigger) throw new Error('edge: trigger not found: ' + args.trigger);

  if (args.step === 'place') {
    const inset = args.inset ?? 8;
    const height = trigger.getBoundingClientRect().height;
    const want = Math.round(
      args.placement === 'top' ? inset
        : args.placement === 'middle' ? (innerHeight - height) / 2
          : innerHeight - inset - height
    );
    const scrollers = [];
    for (let a = trigger.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight) scrollers.push(a);
    }
    scrollers.push(document.scrollingElement || document.documentElement);
    for (const scroller of scrollers) {
      const delta = trigger.getBoundingClientRect().top - want;
      if (Math.abs(delta) < 0.5) break;
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'instant' });
    }
    await frame();
    await frame();
    const top = trigger.getBoundingClientRect().top;
    return { placement: args.placement, want, top: round(top), reached: Math.abs(top - want) <= 1 };
  }

  if (args.step === 'measure') {
    if (args.settle) await new Promise((resolve) => setTimeout(resolve, args.settle));
    await frame();
    await frame();
    const viewport = { width: innerWidth, height: innerHeight };
    const t = trigger.getBoundingClientRect();
    const el = document.querySelector(args.overlay);
    if (!el) return { viewport, trigger: box(t), found: false, visible: false };
    const running = el.getAnimations({ subtree: true }).filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    if (running.length) {
      await Promise.race([Promise.allSettled(running.map((a) => a.finished)), new Promise((r) => setTimeout(r, 2000))]);
      await frame();
    }
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    return {
      viewport,
      trigger: box(trigger.getBoundingClientRect()),
      found: true,
      visible,
      overlay: box(r),
      distance: { top: round(r.top), right: round(viewport.width - r.right), bottom: round(viewport.height - r.bottom), left: round(r.left) },
      coversTrigger: visible && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top
    };
  }

  throw new Error('edge: unknown step ' + JSON.stringify(args.step));
}
