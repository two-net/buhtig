import { TestBed } from '@angular/core/testing';
import { Motion } from './motion';

describe('Motion (FR-ANIM-10)', () => {
  afterEach(() => {
    document.head.querySelector('meta[name="buhtig-animations"]')?.remove();
    document.documentElement.classList.remove('still');
    vi.unstubAllGlobals();
  });

  /** The motion of a page just loaded. */
  function load(): Motion {
    const motion = TestBed.inject(Motion);
    TestBed.tick();
    return motion;
  }

  const still = () => document.documentElement.classList.contains('still');

  it('plays animations in full, unless asked not to', () => {
    expect(load().full()).toBe(true);
    expect(still()).toBe(false);
  });

  it('keeps still for everyone when the server says that ui.animations is off', () => {
    const tag = document.createElement('meta');
    tag.name = 'buhtig-animations';
    tag.content = 'off';
    document.head.append(tag);
    expect(load().full()).toBe(false);
    expect(still()).toBe(true);
  });

  it('keeps still while the browser asks for reduced motion', () => {
    let changed: ((event: { matches: boolean }) => void) | undefined;
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_: string, listener: typeof changed) => (changed = listener),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const motion = load();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(motion.full()).toBe(false);
    expect(still()).toBe(true);

    changed!({ matches: false });
    TestBed.tick();
    expect(motion.full()).toBe(true);
    expect(still()).toBe(false);
  });
});
