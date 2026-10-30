import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { map } from 'rxjs';
import { ChartTable } from '../chart/table';
import { Icon } from '../icon/icon';
import { ENTRANCE_MS, Entrance } from '../motion/entrance';
import { Computing, load } from './load';
import { COMPUTING, FAILED, HELD, LOADED, LOADING, UNAVAILABLE } from './messages';
import { Loaded, Skeleton, Widget } from './widget';

@Component({
  imports: [Loaded, Widget],
  template: `
    <app-widget
      heading="Releases"
      empty="No releases yet."
      emptyIcon="tag"
      skeleton="list"
      [flush]="true"
    >
      <ng-template [appLoaded]="releases" let-releases>
        <ul>
          @for (release of releases; track release) {
            <li>{{ release }}</li>
          }
        </ul>
      </ng-template>
      <a footer href="/acme/widget/releases">See all releases</a>
    </app-widget>
    <app-widget heading="Languages" empty="No code yet." [summary]="summary()" [table]="table()">
      <ng-template [appLoaded]="languages" let-languages>
        <p class="languages">{{ languages.join(', ') }}</p>
      </ng-template>
    </app-widget>
  `,
})
class Host {
  private readonly http = inject(HttpClient);

  readonly repo = signal('acme/widget');
  readonly summary = signal<string | undefined>('Mostly TypeScript.');
  readonly table = signal<ChartTable | undefined>({
    headers: ['Language', 'Share'],
    rows: [
      { label: 'TypeScript', value: '75%' },
      { label: 'CSS', value: '25%' },
    ],
  });
  readonly releases = load(
    () => this.http.get<string[]>(`/releases/${this.repo()}`),
    (releases) => releases.length === 0,
  );
  readonly languages = load(() => this.http.get<string[]>(`/languages/${this.repo()}`));
}

describe('Widget', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const widgets = () => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-widget'),
  ];
  const releases = () => widgets()[0];
  const languages = () => widgets()[1];
  const section = (widget: HTMLElement) => widget.querySelector('section')!;
  const state = (widget: HTMLElement) => widget.querySelector('.w-state')?.textContent?.trim();
  const skeleton = (widget: HTMLElement) => widget.querySelector('.skel');
  const toggle = (widget: HTMLElement) => widget.querySelector<HTMLButtonElement>('.w-head button');
  const status = (widget: HTMLElement) =>
    widget.querySelector('[role="status"]')?.textContent?.trim();
  /** The names of the icons that `widget` shows. */
  const icons = (widget: HTMLElement) =>
    fixture.debugElement
      .queryAll(By.directive(Icon))
      .filter((icon) => widget.contains(icon.nativeElement))
      .map((icon) => (icon.componentInstance as Icon).name());

  /** Answers the widgets' requests with these releases and languages. */
  async function answer(
    releases: string[] | ProgressEvent,
    languages: string[] | ProgressEvent,
  ): Promise<void> {
    for (const [url, body] of [
      ['/releases/acme/widget', releases],
      ['/languages/acme/widget', languages],
    ] as const) {
      const request = http.expectOne(url);
      if (body instanceof ProgressEvent) {
        request.error(body);
      } else {
        request.flush(body);
      }
    }
    await fixture.whenStable();
  }

  async function set(change: (host: Host) => void): Promise<void> {
    change(fixture.componentInstance);
    await fixture.whenStable();
  }

  it('heads each widget, and names it by its heading', async () => {
    const heading = section(releases()).querySelector('h2')!;
    expect(heading.textContent?.trim()).toBe('Releases');
    expect(section(releases()).getAttribute('aria-labelledby')).toBe(heading.id);
    expect(section(languages()).querySelector('h2')!.id).not.toBe(heading.id);
    await answer([], []);
  });

  it('shows a placeholder until its data is there (FR-REPO-09)', async () => {
    for (const widget of widgets()) {
      expect(section(widget).getAttribute('aria-busy')).toBe('true');
      expect(skeleton(widget)?.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(widget.querySelector('p.sr')?.textContent?.trim()).toBe(LOADING);
    }
    await answer(['v2.0.0', 'v1.0.0'], ['TypeScript', 'CSS']);
    expect(section(releases()).getAttribute('aria-busy')).toBe('false');
    expect(skeleton(releases())).toBeNull();
    expect(releases().textContent).not.toContain(LOADING);
    expect([...releases().querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'v2.0.0',
      'v1.0.0',
    ]);
    expect(languages().querySelector('.languages')?.textContent).toBe('TypeScript, CSS');
  });

  it("shapes its placeholder after its content's, so that little moves once it is there", async () => {
    // The list's rows here, and a chart's block by default.
    expect(releases().querySelectorAll('.skel-row')).toHaveLength(5);
    expect(languages().querySelectorAll('.skel.block')).toHaveLength(1);
    await answer([], []);
  });

  it('shows what it shows up to its edges, once it shows it, on request', async () => {
    const body = (widget: HTMLElement) => widget.querySelector('.w-body')!;
    expect(body(releases()).classList).not.toContain('flush');
    await answer(['v1.0.0'], ['TypeScript']);
    expect(body(releases()).classList).toContain('flush');
    expect(body(languages()).classList).not.toContain('flush');
  });

  it('says what its content shows below its heading, once it shows it', async () => {
    const summary = () => languages().querySelector('.w-sub')?.textContent?.trim();
    expect(summary()).toBeUndefined();
    await answer(['v1.0.0'], ['TypeScript']);
    expect(summary()).toBe('Mostly TypeScript.');
    expect(releases().querySelector('.w-sub')).toBeNull();
    await set((host) => host.summary.set(undefined));
    expect(summary()).toBeUndefined();
  });

  it('shows what goes below its content once it shows, such as a link to see more', async () => {
    const footer = () => releases().querySelector('a[footer]');
    expect(footer()).toBeNull();
    await answer(['v1.0.0'], ['TypeScript']);
    expect(footer()?.textContent).toBe('See all releases');
  });

  it('shows no link to see more of nothing, nor of what failed', async () => {
    await answer([], ['TypeScript']);
    expect(releases().querySelector('a[footer]')).toBeNull();
  });

  it('says when there is nothing to show, which is no failure (FR-REPO-11)', async () => {
    await answer([], ['TypeScript']);
    expect(state(releases())).toBe('No releases yet.');
    expect(icons(releases())).toEqual(['tag']);
    expect(releases().querySelector('ul, button')).toBeNull();
  });

  it('says when its data failed to load, and tries again (FR-REPO-09)', async () => {
    await answer(new ProgressEvent('error'), ['TypeScript']);
    expect(state(releases())).toBe(`${FAILED}Try again`);
    expect(icons(releases())).toEqual(['alert', 'refresh']);
    releases().querySelector('button')!.click();
    await fixture.whenStable();
    expect(skeleton(releases())).not.toBeNull();
    http.expectOne('/releases/acme/widget').flush(['v1.0.0']);
    await fixture.whenStable();
    expect(releases().querySelector('li')?.textContent?.trim()).toBe('v1.0.0');
  });

  it('says what failed, and what to do about it (NFR-UX-06)', async () => {
    http
      .expectOne('/releases/acme/widget')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    http
      .expectOne('/languages/acme/widget')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(releases().querySelector('.w-state span')?.textContent).toBe(UNAVAILABLE);
    expect(releases().querySelector('button')?.textContent?.trim()).toBe('Try again');
    expect(languages().querySelector('.w-state span')?.textContent).toBe(FAILED);
    expect(languages().querySelector('button')?.textContent?.trim()).toBe('Try again');
    // No table of what failed.
    expect(toggle(languages())).toBeNull();
  });

  it('asks a visitor to sign in once the server asks GitHub for no more (FR-DATA-10)', async () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/acme/widget');
    http
      .expectOne('/releases/acme/widget')
      .flush(null, { status: 429, statusText: 'Too Many Requests' });
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    await fixture.whenStable();
    expect(releases().querySelector('.w-state span')?.textContent).toBe(HELD);
    // Trying again soon would not help.
    expect(releases().querySelector('button')).toBeNull();
    const signIn = releases().querySelector('.w-state a')!;
    expect(signIn.textContent?.trim()).toBe('Sign in');
    expect(signIn.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2Facme%2Fwidget');
  });

  it('keeps focus on the widget as "Try again" goes, and says what it came to (NFR-UX-03)', async () => {
    await answer(new ProgressEvent('error'), ['TypeScript']);
    // Nothing is announced of what the page shows as it loads.
    expect(status(releases())).toBe('');

    const button = releases().querySelector('button')!;
    button.focus();
    button.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(section(releases()));
    expect(section(releases()).getAttribute('tabindex')).toBe('-1');
    expect(status(releases())).toBe('');

    http.expectOne('/releases/acme/widget').error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(status(releases())).toBe(FAILED);

    releases().querySelector('button')!.click();
    await fixture.whenStable();
    http.expectOne('/releases/acme/widget').flush(['v1.0.0']);
    await fixture.whenStable();
    expect(status(releases())).toBe(LOADED);
    expect(document.activeElement).toBe(section(releases()));
  });

  it('says that "Try again" found nothing to show, when it did', async () => {
    await answer(new ProgressEvent('error'), ['TypeScript']);
    releases().querySelector('button')!.click();
    await fixture.whenStable();
    http.expectOne('/releases/acme/widget').flush([]);
    await fixture.whenStable();
    expect(status(releases())).toBe('No releases yet.');
  });

  it('keeps a failure to its own widget, while the others show theirs (FR-REPO-09)', async () => {
    http.expectOne('/releases/acme/widget').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(releases().querySelector('.w-state span')?.textContent).toBe(FAILED);
    expect(skeleton(languages())).not.toBeNull();
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    await fixture.whenStable();
    expect(languages().querySelector('.languages')?.textContent).toBe('TypeScript');
    expect(releases().querySelector('.w-state span')?.textContent).toBe(FAILED);
  });

  it('loads anew for another resource, and drops what it was loading', async () => {
    const stale = http.expectOne('/releases/acme/widget');
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    await set((host) => host.repo.set('acme/gadget'));
    expect(stale.cancelled).toBe(true);
    expect(skeleton(languages())).not.toBeNull();
    http.expectOne('/releases/acme/gadget').flush(['v3.0.0']);
    http.expectOne('/languages/acme/gadget').flush(['Rust']);
    await fixture.whenStable();
    expect(releases().querySelector('li')?.textContent?.trim()).toBe('v3.0.0');
    expect(languages().querySelector('.languages')?.textContent).toBe('Rust');
  });

  describe('as a table (NFR-UX-04)', () => {
    const table = () => languages().querySelector('app-data-table');

    it('offers its data as a table once its chart shows', async () => {
      expect(toggle(languages())).toBeNull();
      await answer(['v1.0.0'], ['TypeScript']);
      expect(toggle(languages())?.textContent?.trim()).toBe('Show table');
      expect(toggle(languages())?.getAttribute('aria-pressed')).toBe('false');
      // Nor for a widget without one.
      expect(toggle(releases())).toBeNull();
    });

    it('shows the table in place of the chart, and the chart again', async () => {
      await answer(['v1.0.0'], ['TypeScript']);
      toggle(languages())!.click();
      await fixture.whenStable();
      expect(toggle(languages())?.textContent?.trim()).toBe('Show chart');
      expect(toggle(languages())?.getAttribute('aria-pressed')).toBe('true');
      expect(languages().querySelector('.languages')).toBeNull();
      expect(
        [...table()!.querySelectorAll('tbody tr')].map((row) => row.textContent?.trim()),
      ).toEqual(['TypeScript75%', 'CSS25%']);

      toggle(languages())!.click();
      await fixture.whenStable();
      expect(toggle(languages())?.textContent?.trim()).toBe('Show table');
      expect(table()).toBeNull();
      expect(languages().querySelector('.languages')?.textContent).toBe('TypeScript');
    });

    it('shows the chart again once its data changes', async () => {
      await answer(['v1.0.0'], ['TypeScript']);
      toggle(languages())!.click();
      await fixture.whenStable();
      await set((host) =>
        host.table.set({
          headers: ['Language', 'Share'],
          rows: [{ label: 'Rust', value: '100%' }],
        }),
      );
      expect(table()).toBeNull();
      expect(toggle(languages())?.getAttribute('aria-pressed')).toBe('false');
    });

    it('offers none once it has no table to show', async () => {
      await answer(['v1.0.0'], ['TypeScript']);
      await set((host) => host.table.set(undefined));
      expect(toggle(languages())).toBeNull();
    });
  });
});

@Component({
  imports: [Loaded, Widget],
  template: `
    <app-widget heading="Commit activity" empty="No commits in the last year.">
      <ng-template [appLoaded]="activity" let-activity>
        <p class="activity">{{ activity.join(', ') }}</p>
      </ng-template>
    </app-widget>
  `,
})
class Statistic {
  private readonly http = inject(HttpClient);

  readonly activity = load(() =>
    this.http.get<number[]>('/activity/acme/widget', { observe: 'response' }).pipe(
      map((response) => {
        if (response.status === 202) {
          throw new Computing();
        }
        return response.body!;
      }),
    ),
  );
}

describe('Widget of a statistic', () => {
  let fixture: ComponentFixture<Statistic>;
  let http: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Statistic);
    TestBed.tick();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const element = () => fixture.nativeElement as HTMLElement;

  it('says while GitHub is still computing it, and that it asks again (FR-REPO-10)', () => {
    http.expectOne('/activity/acme/widget').flush(null, { status: 202, statusText: 'Accepted' });
    TestBed.tick();
    const said = element().querySelector('.w-state.calc')!;
    expect(said.textContent?.trim()).toBe(COMPUTING);
    expect(said.textContent?.trim()).toBe('Calculating on GitHub… This retries automatically.');
    const icon = fixture.debugElement.query(By.css('.w-state app-icon'));
    expect((icon.componentInstance as Icon).name()).toBe('spinner');
    expect(element().querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(element().querySelector('.activity, button, .skel')).toBeNull();

    vi.advanceTimersByTime(1_000);
    http.expectOne('/activity/acme/widget').flush([3, 4]);
    TestBed.tick();
    expect(element().querySelector('.activity')?.textContent).toBe('3, 4');
    expect(element().querySelector('section')?.getAttribute('aria-busy')).toBe('false');
  });
});

/** What a widget's content sees of the widget's entrance, which it enters by. */
@Component({ selector: 'app-probe', template: `{{ entrance.playing() }}` })
class Probe {
  readonly entrance = inject(Entrance);
}

@Component({
  imports: [Loaded, Probe, Widget],
  template: `
    <app-widget heading="Releases" empty="No releases yet.">
      <ng-template [appLoaded]="releases"><app-probe /></ng-template>
    </app-widget>
  `,
})
class Probed {
  private readonly http = inject(HttpClient);

  readonly releases = load(() => this.http.get<string[]>('/releases/acme/widget'));
}

@Component({
  imports: [Loaded, Widget],
  template: `
    <app-widget heading="Releases" empty="No releases yet." [skeleton]="skeleton()">
      <ng-template [appLoaded]="releases">Shown</ng-template>
    </app-widget>
  `,
})
class Shaped {
  private readonly http = inject(HttpClient);

  readonly skeleton = signal<Skeleton>('chart');
  readonly releases = load(() => this.http.get<string[]>('/releases/acme/widget'));
}

describe('Widget placeholder (FR-ANIM-04)', () => {
  it("is shaped after each kind of content's", async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(Shaped);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const shape = async (skeleton: Skeleton) => {
      fixture.componentInstance.skeleton.set(skeleton);
      await fixture.whenStable();
      const placeholder = element.querySelector('.w-body > [aria-hidden="true"]')!;
      return [
        placeholder.querySelectorAll('.skel-row').length,
        placeholder.querySelectorAll('.skel.line.bar').length,
        placeholder.querySelectorAll(':scope > .skel.line').length,
        placeholder.querySelectorAll('.skel.block').length,
      ];
    };
    // Rows of a list, bars, a split bar over its legend, or a chart's block.
    expect(await shape('list')).toEqual([5, 0, 0, 0]);
    expect(await shape('bars')).toEqual([0, 6, 6, 0]);
    expect(await shape('stack')).toEqual([0, 0, 5, 0]);
    expect(await shape('chart')).toEqual([0, 0, 0, 1]);
    TestBed.inject(HttpTestingController).expectOne('/releases/acme/widget');
  });
});

/** The stand-ins for the browser's `IntersectionObserver`, which jsdom lacks. */
const observers: Observer[] = [];

class Observer {
  readonly targets = new Set<Element>();

  constructor(readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    observers.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  disconnect(): void {
    this.targets.clear();
  }
}

describe('Widget entrance (FR-ANIM-07)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', Observer);
    observers.length = 0;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.head.querySelector('meta[name="buhtig-animations"]')?.remove();
    document.documentElement.classList.remove('still');
  });

  /** Shows the widgets, loading. */
  function show(): HTMLElement[] {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-widget')];
  }

  /** Answers the widgets' requests. */
  function answer(): void {
    http.expectOne('/releases/acme/widget').flush(['v2.0.0', 'v1.0.0']);
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    TestBed.tick();
  }

  /** Brings `widgets` into view, or takes them out of it. */
  function scroll(inView: boolean, ...widgets: HTMLElement[]): void {
    for (const observer of observers) {
      for (const target of widgets.filter((widget) => observer.targets.has(widget))) {
        observer.callback([{ target, isIntersecting: inView }]);
      }
    }
    TestBed.tick();
  }

  const entering = (widgets: HTMLElement[]) =>
    widgets.map((widget) => widget.classList.contains('entering'));

  it('makes its entrance as its content is first shown in view, for a moment', () => {
    const widgets = show();
    scroll(true, ...widgets);
    expect(entering(widgets)).toEqual([false, false]);
    answer();
    expect(entering(widgets)).toEqual([true, true]);
    vi.advanceTimersByTime(ENTRANCE_MS - 1);
    TestBed.tick();
    expect(entering(widgets)).toEqual([true, true]);
    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(entering(widgets)).toEqual([false, false]);
    // Not again as it scrolls out of view and back.
    scroll(false, ...widgets);
    scroll(true, ...widgets);
    expect(entering(widgets)).toEqual([false, false]);
  });

  it('waits for content shown out of view to scroll into view', () => {
    const [releases, languages] = show();
    scroll(true, languages);
    scroll(false, languages);
    answer();
    expect(entering([releases, languages])).toEqual([false, false]);
    scroll(true, languages);
    expect(entering([releases, languages])).toEqual([false, true]);
    scroll(true, releases);
    expect(entering([releases, languages])).toEqual([true, true]);
  });

  it('makes no entrance again on the same page, as after a refresh', () => {
    const before = show();
    scroll(true, ...before);
    answer();
    expect(entering(before)).toEqual([true, true]);
    const after = show();
    scroll(true, ...after);
    answer();
    expect(entering(after)).toEqual([false, false]);
  });

  it('makes none while motion is off (FR-ANIM-10)', () => {
    const tag = document.createElement('meta');
    tag.name = 'buhtig-animations';
    tag.content = 'off';
    document.head.append(tag);
    const widgets = show();
    scroll(true, ...widgets);
    answer();
    expect(entering(widgets)).toEqual([false, false]);
  });

  it('ends its entrance at once as the browser asks for reduced motion (FR-ANIM-10)', () => {
    let changed: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, listener: typeof changed) => (changed = listener),
    }));
    const widgets = show();
    scroll(true, ...widgets);
    answer();
    expect(entering(widgets)).toEqual([true, true]);
    changed!({ matches: true });
    TestBed.tick();
    expect(entering(widgets)).toEqual([false, false]);
  });

  it('tells its content of its entrance', () => {
    const fixture = TestBed.createComponent(Probed);
    TestBed.tick();
    const widget = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-widget')!;
    scroll(true, widget);
    http.expectOne('/releases/acme/widget').flush(['v1.0.0']);
    TestBed.tick();
    expect(widget.querySelector('app-probe')?.textContent).toBe('true');
    vi.advanceTimersByTime(ENTRANCE_MS);
    TestBed.tick();
    expect(widget.querySelector('app-probe')?.textContent).toBe('false');
  });

  it('makes none where the browser cannot tell what is in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const widgets = show();
    answer();
    expect(observers).toEqual([]);
    expect(entering(widgets)).toEqual([false, false]);
  });
});
