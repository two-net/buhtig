import { Component, ElementRef, afterNextRender, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { focusPageOnNavigation } from './page-focus';

@Component({
  template: `<main>
    <h1>First</h1>
    <button>Go</button>
  </main>`,
})
class First {}

@Component({ template: `<main><h1>Second</h1></main>` })
class Second {}

/** A page that puts focus in its own input, as the home page does. */
@Component({
  template: `<main>
    <h1>Search</h1>
    <input #box />
  </main>`,
})
class Search {
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  constructor() {
    afterNextRender(() => this.box().nativeElement.focus());
  }
}

@Component({ template: `<main><p>No heading</p></main>` })
class Headless {}

/** The pages, under an input that stays from one page to the next, as a dashboard's header does. */
@Component({ imports: [RouterOutlet], template: `<input id="kept" /><router-outlet />` })
class Shell {}

describe('focusPageOnNavigation', () => {
  let fixture: ComponentFixture<Shell>;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'first', component: First },
          { path: 'second', component: Second },
          { path: 'search', component: Search },
          { path: 'headless', component: Headless },
        ]),
      ],
    });
    TestBed.runInInjectionContext(focusPageOnNavigation);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(Shell);
    await go('/first');
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const heading = () => element().querySelector('h1')!;

  async function go(url: string, replaceUrl = false): Promise<void> {
    await router.navigateByUrl(url, { replaceUrl });
    await fixture.whenStable();
  }

  it('leaves focus be on the page as served', () => {
    expect(heading().textContent).toBe('First');
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses the heading of the next page once what had focus is gone (WCAG 2.4.3)', async () => {
    element().querySelector('button')!.focus();
    await go('/second');
    expect(document.activeElement).toBe(heading());
    expect(heading().textContent).toBe('Second');
    // Focusable by script alone, out of the tab order.
    expect(heading().getAttribute('tabindex')).toBe('-1');
  });

  it('focuses the heading of the next page from what keeps focus across pages', async () => {
    element().querySelector<HTMLInputElement>('#kept')!.focus();
    await go('/second');
    expect(document.activeElement).toBe(heading());
  });

  it('focuses the heading of the next page from no focus at all', async () => {
    await go('/second');
    expect(document.activeElement).toBe(heading());
  });

  it('leaves focus where the next page puts it', async () => {
    element().querySelector('button')!.focus();
    await go('/search');
    expect(document.activeElement).toBe(element().querySelector('main input'));
  });

  it('leaves focus be as the URL changes in place', async () => {
    const kept = element().querySelector<HTMLInputElement>('#kept')!;
    kept.focus();
    await go('/second', true);
    expect(document.activeElement).toBe(kept);
  });

  it('focuses the main content of a page without a heading', async () => {
    await go('/headless');
    expect(document.activeElement).toBe(element().querySelector('main'));
  });
});
