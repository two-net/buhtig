import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ENTRANCE_MS, Enter, Entrance, Entrances } from './entrance';

@Component({ template: '' })
class Page {}

describe('Entrances (FR-ANIM-07)', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Page }])],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    document.head.querySelector('meta[name="buhtig-animations"]')?.remove();
    document.documentElement.classList.remove('still');
    vi.unstubAllGlobals();
  });

  it('lets each widget make its entrance once on a page, and not again after a refresh', async () => {
    await router.navigateByUrl('/acme/widget');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(true);
    expect(entrances.claim('Languages')).toBe(true);
    // As the widgets that a refresh makes anew do.
    expect(entrances.claim('Statistics')).toBe(false);
    expect(entrances.claim('Languages')).toBe(false);
  });

  it('lets them make it again on the page of another navigation', async () => {
    await router.navigateByUrl('/acme/widget');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(true);
    await router.navigateByUrl('/acme/gadget');
    expect(entrances.claim('Statistics')).toBe(true);
    // Back on a dashboard viewed before, too.
    await router.navigateByUrl('/acme/widget');
    expect(entrances.claim('Statistics')).toBe(true);
    expect(entrances.claim('Statistics')).toBe(false);
  });

  it('takes the tabs of a dashboard for one page, as they are', async () => {
    await router.navigateByUrl('/acme/widget');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(true);
    for (const tab of ['/acme/widget/issues', '/acme/widget/graphs/contributors', '/Acme/Widget']) {
      await router.navigateByUrl(tab);
      expect(entrances.claim('Statistics'), tab).toBe(false);
    }
    expect(entrances.claim('Issues')).toBe(true);

    await router.navigateByUrl('/acme');
    expect(entrances.claim('Statistics')).toBe(true);
    await router.navigateByUrl('/orgs/acme/people');
    expect(entrances.claim('Statistics')).toBe(false);
  });

  it('knows the dashboard it is made on, after the navigation that opened it', async () => {
    await router.navigateByUrl('/acme/widget/releases');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Releases')).toBe(true);
    await router.navigateByUrl('/acme/widget');
    expect(entrances.claim('Releases')).toBe(false);
  });

  it("takes each of BuhTig's own pages for a page of its own", async () => {
    await router.navigateByUrl('/-/settings');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Shortcuts')).toBe(true);
    for (const page of ['/-/about', '/-/settings', '/', '/acme/widget', '/']) {
      await router.navigateByUrl(page);
      expect(entrances.claim('Shortcuts'), page).toBe(true);
    }
  });

  it('lets none make it when the server says that ui.animations is off (FR-ANIM-10)', () => {
    const tag = document.createElement('meta');
    tag.name = 'buhtig-animations';
    tag.content = 'off';
    document.head.append(tag);
    expect(TestBed.inject(Entrances).claim('Statistics')).toBe(false);
  });

  it('lets none make it while the browser asks for reduced motion (FR-ANIM-10)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(false);
    expect(entrances.claim('Statistics')).toBe(false);
  });
});

/** What the content of a box that enters sees of its entrance. */
@Component({ selector: 'app-probe', template: `{{ entrance.playing() }}` })
class Probe {
  readonly entrance = inject(Entrance);
}

@Component({
  imports: [Enter, Probe],
  template: `
    <div class="stats" appEnter="Statistics" [appEnterReady]="ready()"><app-probe /></div>
    <div class="head" appEnter="Head"></div>
  `,
})
class Host {
  readonly ready = signal(false);
}

/** The stand-ins for the browser's `IntersectionObserver`, which jsdom lacks. */
const observers: Observer[] = [];

class Observer {
  readonly targets = new Set<Element>();

  constructor(
    readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
    readonly options: IntersectionObserverInit,
  ) {
    observers.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  disconnect(): void {
    this.targets.clear();
  }
}

describe('Enter (FR-ANIM-07)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', Observer);
    observers.length = 0;
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const stats = () => element().querySelector<HTMLElement>('.stats')!;
  const head = () => element().querySelector<HTMLElement>('.head')!;
  const entering = () => [stats(), head()].map((box) => box.classList.contains('entering'));

  /** Brings `boxes` into view, or takes them out of it. */
  function scroll(inView: boolean, ...boxes: HTMLElement[]): void {
    for (const observer of observers) {
      for (const target of boxes.filter((box) => observer.targets.has(box))) {
        observer.callback([{ target, isIntersecting: inView }]);
      }
    }
    TestBed.tick();
  }

  it('watches what it is on come into view, once a tenth or so of it shows', () => {
    expect(observers.map((observer) => [...observer.targets])).toEqual([[stats()], [head()]]);
    expect(observers[0].options).toEqual({ threshold: 0.12 });
  });

  it('makes the entrance of what it is on as it comes into view, for a moment', () => {
    scroll(true, head());
    expect(entering()).toEqual([false, true]);
    vi.advanceTimersByTime(ENTRANCE_MS);
    TestBed.tick();
    expect(entering()).toEqual([false, false]);
  });

  it('waits until what it shows is there, as it says', () => {
    scroll(true, stats());
    expect(entering()).toEqual([false, false]);
    fixture.componentInstance.ready.set(true);
    TestBed.tick();
    expect(entering()).toEqual([true, false]);
  });

  it('tells what it shows of its entrance', () => {
    fixture.componentInstance.ready.set(true);
    scroll(true, stats());
    expect(stats().querySelector('app-probe')?.textContent).toBe('true');
    vi.advanceTimersByTime(ENTRANCE_MS);
    TestBed.tick();
    expect(stats().querySelector('app-probe')?.textContent).toBe('false');
  });

  it('takes the last word of the browser on whether it is in view', () => {
    observers[1].callback([
      { target: head(), isIntersecting: true },
      { target: head(), isIntersecting: false },
    ]);
    TestBed.tick();
    expect(entering()).toEqual([false, false]);
  });

  it('stops watching once it is gone', () => {
    fixture.destroy();
    expect(observers.every((observer) => observer.targets.size === 0)).toBe(true);
  });
});
