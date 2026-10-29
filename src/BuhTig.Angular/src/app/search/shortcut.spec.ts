import { TestBed } from '@angular/core/testing';
import { Shortcut } from './shortcut';

describe('Shortcut', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** The shortcut as a page newly loaded finds it. */
  function loaded(): Shortcut {
    TestBed.resetTestingModule();
    return TestBed.inject(Shortcut);
  }

  it('is on unless turned off', () => {
    expect(loaded().enabled()).toBe(true);
  });

  it('stays off once turned off, until turned on again (WCAG 2.1.4)', () => {
    loaded().set(false);
    expect(loaded().enabled()).toBe(false);
    loaded().set(true);
    expect(loaded().enabled()).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('still turns off where the browser keeps nothing, for as long as the page is open', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const shortcut = loaded();
    expect(shortcut.enabled()).toBe(true);
    shortcut.set(false);
    expect(shortcut.enabled()).toBe(false);
  });
});
