/*
 * Il poco movimento della revisione della proposta (own-profile-services, PROPOSAL-DESIGN §4): WAAPI comandata da
 * un'azione, mai al montaggio. Ogni animazione parte solo con la pagina visibile — in `agent-browser` le pagine sono
 * nascoste e lo stato finale arriva subito — e con `prefers-reduced-motion: reduce` resta solo la dissolvenza.
 */

export const EASE_OUT_QUINT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_HEIGHT = 'cubic-bezier(0.25, 1, 0.5, 1)';

export const canAnimate = () => document.visibilityState === 'visible';
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Spostamento nella stessa pagina (M12): il focus va al bersaglio senza saltare, poi la pagina lo raggiunge — morbida
 * solo se visibile e senza riduzione del movimento. Il bersaglio porta il suo `scroll-mt-*`.
 */
export function revealAndFocus(target: HTMLElement, block: ScrollLogicalPosition = 'start'): void {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block, behavior: canAnimate() && !reducedMotion() ? 'smooth' : 'auto' });
}

/**
 * Una riga che cambia forma al suo posto (M1/M2): l'altezza va da quella vista prima (`from`) alla nuova in
 * clamp(|Δ| / 500 s, 150, 270) ms — in chiusura × 0,8 — e il contenuto nuovo entra in dissolvenza. Va chiamata dopo il
 * commit (layout effect), con le animazioni precedenti già cancellate. Ritorna l'altezza d'arrivo.
 */
export function animateRowChange(row: HTMLElement, content: HTMLElement | null, from: number): number {
  const to = row.getBoundingClientRect().height;
  if (!canAnimate() || Math.abs(to - from) <= 1) return to;
  const reduce = reducedMotion();
  if (!reduce) {
    const base = Math.min(Math.max(Math.abs(to - from) / 500, 0.15), 0.27) * 1000;
    row.style.overflow = 'hidden';
    const restore = () => {
      row.style.overflow = '';
    };
    row
      .animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: Math.round(to < from ? base * 0.8 : base),
        easing: EASE_HEIGHT,
      })
      .finished.then(restore, restore);
  }
  content?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: reduce ? 'ease' : EASE_OUT_QUINT });
  return to;
}

/** Il riepilogo di chiusura che si posa (M8): opacity e 4 px; con la riduzione del movimento solo opacity. */
export function animateSettle(el: HTMLElement): void {
  if (!canAnimate()) return;
  const reduce = reducedMotion();
  el.animate(
    reduce
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
    { duration: reduce ? 200 : 220, easing: reduce ? 'ease' : EASE_OUT_QUINT },
  );
}
