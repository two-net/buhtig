import { isApple, opensPalette, paletteKeys } from './keys';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', cancelable: true, ...init });
}

describe('opensPalette (FR-SRCH-12)', () => {
  it('takes Ctrl+K, but on a Mac, an iPhone or an iPad', () => {
    expect(opensPalette(key({ ctrlKey: true }), false)).toBe(true);
    expect(opensPalette(key({ metaKey: true }), false)).toBe(false);
    expect(opensPalette(key({ ctrlKey: true, metaKey: true }), false)).toBe(false);
  });

  it('takes ⌘K on a Mac, an iPhone or an iPad, and leaves Ctrl+K to text fields there', () => {
    expect(opensPalette(key({ metaKey: true }), true)).toBe(true);
    expect(opensPalette(key({ ctrlKey: true }), true)).toBe(false);
  });

  it('takes no other chord, nor K alone, which the user may be typing', () => {
    expect(opensPalette(key({}), false)).toBe(false);
    expect(opensPalette(key({ ctrlKey: true, shiftKey: true, key: 'K' }), false)).toBe(false);
    expect(opensPalette(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(opensPalette(key({ ctrlKey: true, key: 'j', code: 'KeyJ' }), false)).toBe(false);
  });

  it('takes the key once as it is held, and not once something else has handled it', () => {
    expect(opensPalette(key({ ctrlKey: true, repeat: true }), false)).toBe(false);
    const handled = key({ ctrlKey: true });
    handled.preventDefault();
    expect(opensPalette(handled, false)).toBe(false);
  });

  it('takes K where QWERTY has it on a layout that types no Latin letters', () => {
    expect(opensPalette(key({ ctrlKey: true, key: 'л' }), false)).toBe(true);
    // A Latin layout's K, wherever it is.
    expect(opensPalette(key({ ctrlKey: true, key: 'k', code: 'KeyV' }), false)).toBe(true);
    expect(opensPalette(key({ ctrlKey: true, key: 't', code: 'KeyK' }), false)).toBe(false);
  });
});

describe('isApple and paletteKeys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells Apple's devices by their platform", () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isApple()).toBe(true);
    vi.stubGlobal('navigator', { platform: 'iPhone' });
    expect(isApple()).toBe(true);
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: '' });
    expect(isApple()).toBe(true);
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, platform: 'Win32' });
    expect(isApple()).toBe(false);
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
    expect(isApple()).toBe(false);
  });

  it('names the keys as each platform does', () => {
    expect(paletteKeys(true)).toEqual(['⌘', 'K']);
    expect(paletteKeys(false)).toEqual(['Ctrl', 'K']);
  });
});
