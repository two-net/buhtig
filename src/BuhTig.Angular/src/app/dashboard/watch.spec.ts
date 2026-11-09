import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Known } from '../search/parse';
import { Toasts } from '../toast/toasts';
import {
  ADD_TO_WATCHLIST,
  NO_WATCHLISTS_YET,
  WATCHLISTS_FAILED,
  addedTo,
  problemMessage,
  removedFrom,
} from '../watchlists/messages';
import { Watchlist } from '../watchlists/watchlists';
import { Watch } from './watch';

@Component({
  imports: [Watch],
  template: `<app-watch [resource]="resource()" />`,
})
class Host {
  readonly resource = signal<Known>({ kind: 'repository', owner: 'acme', repo: 'widget' });
}

describe('Watch', () => {
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

  const opener = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
  const dialog = () => document.querySelector<HTMLElement>('.dialog');
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.choices input')];
  const problem = () => dialog()?.querySelector('.field-msg')?.textContent?.trim();
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);

  const DEPENDENCIES: Watchlist = { id: 7, name: 'Dependencies', repositories: ['ACME/Widget'] };
  const TEAM: Watchlist = { id: 9, name: 'Team', repositories: ['octo/thing'] };

  async function signedIn(): Promise<void> {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await fixture.whenStable();
  }

  /** Opens the dialog, and answers the user's watchlists with `lists`. */
  async function open(lists: Watchlist[] = [DEPENDENCIES, TEAM]): Promise<void> {
    await signedIn();
    opener()!.click();
    await fixture.whenStable();
    http.expectOne({ method: 'GET', url: '/-/api/watchlists' }).flush({ watchlists: lists });
    await fixture.whenStable();
  }

  async function tick(box: HTMLInputElement): Promise<void> {
    box.click();
    await fixture.whenStable();
  }

  it('is not offered to visitors (FR-ACC-02)', async () => {
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(opener()).toBeNull();
  });

  it('is not offered on the dashboards of accounts, which go in no watchlist', async () => {
    fixture.componentInstance.resource.set({ kind: 'organization', org: 'acme' });
    await signedIn();
    expect(opener()).toBeNull();
  });

  it("asks for the user's watchlists only once opened, and ticks those that hold it", async () => {
    await signedIn();
    expect(opener()!.textContent?.trim()).toBe(ADD_TO_WATCHLIST);
    http.expectNone('/-/api/watchlists');
    opener()!.click();
    await fixture.whenStable();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Add acme/widget to watchlists');
    http.expectOne('/-/api/watchlists').flush({ watchlists: [DEPENDENCIES, TEAM] });
    await fixture.whenStable();
    expect(
      boxes().map((box) => [box.parentElement?.querySelector('.grow')?.textContent, box.checked]),
    ).toEqual([
      ['Dependencies', true],
      ['Team', false],
    ]);
  });

  it('adds the repository to a watchlist as it is ticked, and takes it out (FR-PERS-07)', async () => {
    await open();
    await tick(boxes()[1]);
    const added = http.expectOne({ method: 'POST', url: '/-/api/watchlists/9/repositories' });
    expect(added.request.body).toEqual({ repositories: ['acme/widget'] });
    added.flush({
      watchlists: [DEPENDENCIES, { ...TEAM, repositories: ['octo/thing', 'acme/widget'] }],
    });
    await fixture.whenStable();
    expect(boxes()[1].checked).toBe(true);
    expect(toasts()).toEqual([addedTo('acme/widget', 'Team')]);

    await tick(boxes()[0]);
    http
      .expectOne({ method: 'DELETE', url: '/-/api/watchlists/7/repositories/acme/widget' })
      .flush({ watchlists: [{ ...DEPENDENCIES, repositories: [] }, TEAM] });
    await fixture.whenStable();
    expect(boxes()[0].checked).toBe(false);
    expect(toasts().at(-1)).toBe(removedFrom('acme/widget', 'Dependencies'));
  });

  it('says when a watchlist holds as many as it may, and leaves it unticked', async () => {
    const full = {
      ...TEAM,
      repositories: Array.from({ length: 25 }, (_, index) => `acme/repo-${index}`),
    };
    await open([DEPENDENCIES, full]);
    await tick(boxes()[1]);
    expect(boxes()[1].checked).toBe(false);
    expect(problem()).toBe(problemMessage('too_many_repositories'));
    http.expectNone((request) => request.method === 'POST');
  });

  it('puts the box back as it was when the server refuses', async () => {
    await open();
    await tick(boxes()[1]);
    http
      .expectOne('/-/api/watchlists/9/repositories')
      .flush({ error: 'too_many_repositories' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(boxes()[1].checked).toBe(false);
    expect(problem()).toBe(problemMessage('too_many_repositories'));
  });

  it('makes a watchlist with the repository in it (FR-PERS-06)', async () => {
    await open([]);
    expect(dialog()?.textContent).toContain(NO_WATCHLISTS_YET);
    const name = dialog()!.querySelector<HTMLInputElement>('input[name="name"]')!;
    const form = dialog()!.querySelector<HTMLFormElement>('form')!;

    form.requestSubmit();
    await fixture.whenStable();
    expect(problem()).toBe(problemMessage('invalid_name'));
    http.expectNone('/-/api/watchlists');

    name.value = ' Dependencies ';
    name.dispatchEvent(new Event('input'));
    form.requestSubmit();
    await fixture.whenStable();
    const made = http.expectOne({ method: 'POST', url: '/-/api/watchlists' });
    expect(made.request.body).toEqual({ name: 'Dependencies', repositories: ['acme/widget'] });
    made.flush({ id: 7, watchlists: [DEPENDENCIES] }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(boxes().map((box) => box.checked)).toEqual([true]);
    expect(name.value).toBe('');
    expect(toasts()).toEqual([addedTo('acme/widget', 'Dependencies')]);
  });

  it('says when it cannot load the watchlists', async () => {
    await signedIn();
    opener()!.click();
    await fixture.whenStable();
    http.expectOne('/-/api/watchlists').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(problem()).toBe(WATCHLISTS_FAILED);
    expect(boxes()).toEqual([]);
  });

  it('leads to the watchlists, and closes with focus back on the button that opened it', async () => {
    await signedIn();
    opener()!.focus();
    opener()!.click();
    await fixture.whenStable();
    http.expectOne('/-/api/watchlists').flush({ watchlists: [DEPENDENCIES] });
    await fixture.whenStable();
    expect(dialog()!.querySelector('a')?.getAttribute('href')).toBe('/-/watchlists');
    const done = [...dialog()!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Done',
    )!;
    done.click();
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });
});
