/**
 * Porta il focus su `target` o, se non c'è (l'elemento che l'aveva è sparito), sul titolo della pagina: l'`h1` di
 * `PageHeader` è focalizzabile da script (FLOW Accessibilità: mai lasciare il focus sul `body`).
 */
export function focusOrPageTitle(target?: HTMLElement | null): void {
  (target ?? document.querySelector<HTMLElement>('main h1'))?.focus();
}
