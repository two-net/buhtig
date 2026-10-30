import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Avatar, avatarOf, identicon } from './avatar';

describe('Avatar', () => {
  let fixture: ComponentFixture<Avatar>;

  async function show(inputs: Record<string, unknown>): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Avatar);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const MONA = 'https://avatars.githubusercontent.com/u/1?v=4';

  it("loads the account's avatar from GitHub, as decoration (FR-DATA-01)", async () => {
    const element = await show({ name: 'mona', src: MONA, size: 32 });
    expect(element.getAttribute('aria-hidden')).toBe('true');
    const image = element.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(MONA);
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('width')).toBe('32');
    expect(image.getAttribute('height')).toBe('32');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(element.querySelector('svg')).toBeNull();
  });

  it('is square, as GitHub draws organizations and repositories, unless round, as people', async () => {
    const element = await show({ name: 'acme', src: MONA });
    expect(element.querySelector('img')!.classList).not.toContain('round');
    expect(element.querySelector('img')!.getAttribute('width')).toBe('20');
    fixture.componentRef.setInput('round', true);
    await fixture.whenStable();
    expect(element.querySelector('img')!.classList).toContain('round');
  });

  it('draws a pattern from the name when it has no avatar to load', async () => {
    const element = await show({ name: 'mona', size: 24, round: true });
    expect(element.querySelector('img')).toBeNull();
    const svg = element.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.classList).toContain('round');
    expect(svg.style.getPropertyValue('--hue')).toBe(String(identicon('mona').hue));
    expect(svg.querySelectorAll('rect.fg')).toHaveLength(identicon('mona').cells.length);
  });

  it('draws the pattern in place of an avatar that fails to load, as offline', async () => {
    const element = await show({ name: 'mona', src: MONA });
    element.querySelector('img')!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('svg')).not.toBeNull();
  });

  it('loads another avatar anew after one failed', async () => {
    const element = await show({ name: 'mona', src: MONA });
    element.querySelector('img')!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    fixture.componentRef.setInput('src', 'https://avatars.githubusercontent.com/u/2?v=4');
    await fixture.whenStable();
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      'https://avatars.githubusercontent.com/u/2?v=4',
    );
  });
});

describe('identicon', () => {
  it('looks the same each time for the same name, whatever its letter case', () => {
    expect(identicon('mona')).toEqual(identicon('mona'));
    expect(identicon('Mona')).toEqual(identicon('mona'));
    expect(identicon('ACME/Widget')).toEqual(identicon('acme/widget'));
  });

  it('looks different for different names', () => {
    const names = ['mona', 'octocat', 'acme', 'acme/widget', 'angular', 'vercel'];
    const looks = new Set(names.map((name) => JSON.stringify(identicon(name))));
    expect(looks.size).toBe(names.length);
  });

  it('is 5 by 5 cells, mirrored left to right, in a hue of the color wheel', () => {
    for (const name of ['mona', 'octocat', 'acme', 'a', '']) {
      const { hue, cells } = identicon(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      for (const { x, y } of cells) {
        expect(
          [x, y].every((at) => Number.isInteger(at) && at >= 0 && at < 5),
          name,
        ).toBe(true);
        expect(cells, name).toContainEqual({ x: 4 - x, y });
      }
    }
  });
});

describe('avatarOf', () => {
  it("is where GitHub serves an account's avatar by its name, at twice the size for sharp screens", () => {
    expect(avatarOf('mona', 20)).toBe('https://avatars.githubusercontent.com/mona?s=40');
  });

  it('escapes the name', () => {
    expect(avatarOf('a/b?c', 16)).toBe('https://avatars.githubusercontent.com/a%2Fb%3Fc?s=32');
  });
});
