import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { percent } from '../format/format';
import { RepositoryLanguages } from './languages';

@Component({
  imports: [RepositoryLanguages],
  template: `<app-repository-languages [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The languages of `acme/widget`, as the server gives them: 10,000 bytes in all. */
const WIDGET = {
  languages: [
    { name: 'Rust', bytes: 6000 },
    { name: 'TypeScript', bytes: 3000 },
    { name: 'CSS', bytes: 990 },
  ],
  other: 10,
};

describe('RepositoryLanguages', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const segments = () => [...element().querySelectorAll<SVGRectElement>('svg rect')];

  /** Each entry of the legend, as its name and its share. */
  const legend = () =>
    [...element().querySelectorAll('li')].map((entry) => [
      entry.querySelector('.name')?.textContent,
      entry.querySelector('.share')?.textContent,
    ]);

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/languages').flush(body);
    await fixture.whenStable();
  }

  it("shows each language's share, and the rest as Other (FR-REPO-04)", async () => {
    await answer(WIDGET);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Languages');
    expect(legend()).toEqual([
      ['Rust', percent(0.6)],
      ['TypeScript', percent(0.3)],
      ['CSS', percent(0.099)],
      ['Other', percent(0.001)],
    ]);
    const bar = segments().map((segment) => [
      Number(segment.getAttribute('x')),
      Number(segment.getAttribute('width')),
    ]);
    for (const [index, [x, width]] of [
      [0, 60],
      [60, 30],
      [90, 9.9],
      [99.9, 0.1],
    ].entries()) {
      expect(bar[index][0]).toBeCloseTo(x);
      expect(bar[index][1]).toBeCloseTo(width);
    }
  });

  it('tells the languages apart by name, not by color alone (NFR-UX-05)', async () => {
    await answer(WIDGET);
    const colors = ['var(--language-1)', 'var(--language-2)', 'var(--language-3)'];
    expect(segments().map((segment) => segment.style.fill)).toEqual([
      ...colors,
      'var(--language-other)',
    ]);
    expect(
      [...element().querySelectorAll<HTMLElement>('.swatch')].map(
        (swatch) => swatch.style.background,
      ),
    ).toEqual([...colors, 'var(--language-other)']);
    // The legend says all that the bar shows.
    expect(element().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no Other when there is no other language, and tells a tiny share', async () => {
    await answer({
      languages: [
        { name: 'Rust', bytes: 9999 },
        { name: 'Shell', bytes: 1 },
      ],
      other: 0,
    });
    expect(legend()).toEqual([
      ['Rust', percent(0.9999)],
      ['Shell', percent(0.0001)],
    ]);
    expect(legend()[1][1]).toMatch(/^</);
  });

  it('says when there is no code (FR-REPO-11)', async () => {
    await answer({ languages: [], other: 0 });
    expect(element().querySelector('.message')?.textContent?.trim()).toBe('No code detected yet.');
    expect(element().querySelector('svg, ul, button')).toBeNull();
  });
});
