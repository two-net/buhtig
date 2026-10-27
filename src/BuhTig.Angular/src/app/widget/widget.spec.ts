import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { map } from 'rxjs';
import { ENTRANCE_MS, Entrance } from '../motion/entrance';
import { Computing, load } from './load';
import { COMPUTING, FAILED, LOADING } from './messages';
import { Loaded, Widget } from './widget';

@Component({
  imports: [Loaded, Widget],
  template: `
    <app-widget heading="Releases" empty="No releases yet." [wide]="true" [hideHeading]="true">
      <ng-template [appLoaded]="releases" let-releases>
        <ul>
          @for (release of releases; track release) {
            <li>{{ release }}</li>
          }
        </ul>
      </ng-template>
    </app-widget>
    <app-widget heading="Languages" empty="No code yet.">
      <ng-template [appLoaded]="languages" let-languages>
        <p class="languages">{{ languages.join(', ') }}</p>
      </ng-template>
    </app-widget>
  `,
})
class Host {
  private readonly http = inject(HttpClient);

  readonly repo = signal('acme/widget');
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
  const message = (widget: HTMLElement) => widget.querySelector('.message')?.textContent?.trim();

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

  it('heads each widget, and lets one span the grid', async () => {
    const heading = section(releases()).querySelector('h2')!;
    expect(heading.textContent?.trim()).toBe('Releases');
    expect(section(releases()).getAttribute('aria-labelledby')).toBe(heading.id);
    expect(section(languages()).querySelector('h2')!.id).not.toBe(heading.id);
    expect(widgets().map((widget) => widget.classList.contains('wide'))).toEqual([true, false]);
    // A heading may be for assistive technology alone.
    expect(
      widgets().map((widget) => widget.querySelector('h2')!.classList.contains('visually-hidden')),
    ).toEqual([true, false]);
    await answer([], []);
  });

  it('shows a placeholder until its data is there (FR-REPO-09)', async () => {
    for (const widget of widgets()) {
      expect(section(widget).getAttribute('aria-busy')).toBe('true');
      expect(widget.querySelector('.skeleton')).not.toBeNull();
      expect(widget.querySelector('p.visually-hidden')?.textContent?.trim()).toBe(LOADING);
    }
    await answer(['v2.0.0', 'v1.0.0'], ['TypeScript', 'CSS']);
    expect(section(releases()).getAttribute('aria-busy')).toBe('false');
    expect(releases().querySelector('.skeleton')).toBeNull();
    expect([...releases().querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'v2.0.0',
      'v1.0.0',
    ]);
    expect(languages().querySelector('.languages')?.textContent).toBe('TypeScript, CSS');
  });

  it('says when there is nothing to show, which is no failure (FR-REPO-11)', async () => {
    await answer([], ['TypeScript']);
    expect(message(releases())).toBe('No releases yet.');
    expect(releases().querySelector('ul, button')).toBeNull();
  });

  it('says when its data failed to load, and tries again (FR-REPO-09)', async () => {
    await answer(new ProgressEvent('error'), ['TypeScript']);
    expect(message(releases())).toBe(FAILED);
    releases().querySelector('button')!.click();
    await fixture.whenStable();
    expect(releases().querySelector('.skeleton')).not.toBeNull();
    http.expectOne('/releases/acme/widget').flush(['v1.0.0']);
    await fixture.whenStable();
    expect(releases().querySelector('li')?.textContent?.trim()).toBe('v1.0.0');
  });

  it('keeps a failure to its own widget, while the others show theirs (FR-REPO-09)', async () => {
    http.expectOne('/releases/acme/widget').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message(releases())).toBe(FAILED);
    expect(languages().querySelector('.skeleton')).not.toBeNull();
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    await fixture.whenStable();
    expect(languages().querySelector('.languages')?.textContent).toBe('TypeScript');
    expect(message(releases())).toBe(FAILED);
  });

  it('loads anew for another resource, and drops what it was loading', async () => {
    const stale = http.expectOne('/releases/acme/widget');
    http.expectOne('/languages/acme/widget').flush(['TypeScript']);
    fixture.componentInstance.repo.set('acme/gadget');
    await fixture.whenStable();
    expect(stale.cancelled).toBe(true);
    expect(languages().querySelector('.skeleton')).not.toBeNull();
    http.expectOne('/releases/acme/gadget').flush(['v3.0.0']);
    http.expectOne('/languages/acme/gadget').flush(['Rust']);
    await fixture.whenStable();
    expect(releases().querySelector('li')?.textContent?.trim()).toBe('v3.0.0');
    expect(languages().querySelector('.languages')?.textContent).toBe('Rust');
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
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Statistic);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  it('says while GitHub is still computing it, over the placeholder (FR-REPO-10)', async () => {
    http.expectOne('/activity/acme/widget').flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.message')?.textContent?.trim()).toBe(COMPUTING);
    expect(element.querySelector('.skeleton')).not.toBeNull();
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(element.querySelector('.activity, button')).toBeNull();
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
