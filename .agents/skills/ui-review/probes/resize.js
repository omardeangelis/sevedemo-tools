// resize, in-page half (recipe R-RESIZE). scripts/probe.sh opens the overlay at
// the wide width, resizes to the narrow one, then reloads there and opens it
// again; it calls this function after each of the three to measure the overlay:
//   {overlay, settle}   the overlay's box against the viewport, once finite
//                       animations on it have finished (2 s cap)
// Returns a plain object; eval prints a JSON.stringify string as a quoted literal.
async (args) => {
  const round = (n) => Math.round(n * 100) / 100;
  const frame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
  if (args.settle) await new Promise((resolve) => setTimeout(resolve, args.settle));
  await frame();
  await frame();

  const viewport = { width: innerWidth, height: innerHeight };
  const el = document.querySelector(args.overlay);
  if (!el) return { viewport, found: false, visible: false, box: null };

  const running = el.getAnimations({ subtree: true }).filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
  if (running.length) {
    await Promise.race([Promise.allSettled(running.map((a) => a.finished)), new Promise((r) => setTimeout(r, 2000))]);
    await frame();
  }

  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    viewport,
    found: true,
    visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden',
    box: { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) }
  };
}
