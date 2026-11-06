// The keys that open the command palette (FR-SRCH-12), with the app's code, which listens for
// them on every page, apart from the palette's, which comes as it is opened.

/** Whether the browser runs on a Mac, an iPhone or an iPad, whose shortcuts use ⌘ for Ctrl. */
export function isApple(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Whether `event` is ⌘K on a Mac, an iPhone or an iPad, or Ctrl+K elsewhere, which opens and
 * closes the command palette. It is a chord, not a single key that speech input could press by
 * mistake (WCAG 2.1.4), so it works in text fields too. A layout that types no Latin letters has
 * K where QWERTY has it.
 */
export function opensPalette(event: KeyboardEvent, apple = isApple()): boolean {
  const key = event.key.length === 1 && /[a-z]/i.test(event.key) ? event.key : event.code;
  return (
    (key === 'k' || key === 'K' || key === 'KeyK') &&
    (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.defaultPrevented
  );
}

/** The keys that open the command palette, as BuhTig names them. */
export function paletteKeys(apple = isApple()): string[] {
  return [apple ? '⌘' : 'Ctrl', 'K'];
}
