import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { HeadActions } from '../dashboard/head-actions';
import { Clock } from '../format/clock';
import { GITHUB_COM, GITHUB_HOST } from '../github/host';
import { problemMessage } from '../search/messages';
import { Known } from '../search/parse';
import { COMPARE_WITH, anotherKind, compareHeading, sameResource } from './messages';

@Component({ template: '' })
class Page {}

@Component({
  imports: [HeadActions],
  template: `<app-head-actions [resource]="resource()" [path]="'/' + name()" />`,
})
class Host {
  readonly resource = signal<Known>({ kind: 'repository', owner: 'acme', repo: 'widget' });
  readonly name = signal('acme/widget');
}

describe('CompareDialog (FR-CMP-02)', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;

  /** Shows the dashboard's head, with GitHub at `host`. */
  async function setup(host = GITHUB_COM): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Page }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(Date.now()) } },
        { provide: GITHUB_HOST, useValue: host },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  }

  beforeEach(() => setup());

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const dialog = () => element().querySelector<HTMLElement>('[role="dialog"]');
  const input = () => dialog()!.querySelector<HTMLInputElement>('input')!;
  const problem = () => dialog()!.querySelector('[role="alert"]')?.textContent?.trim();

  /** Opens the dialog from the dashboard's head. */
  async function open(): Promise<void> {
    const button = [...element().querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === COMPARE_WITH,
    )!;
    button.click();
    await fixture.whenStable();
  }

  /** Types `text` in the dialog's input, and submits it. */
  async function compareWith(text: string): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    dialog()!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it("is offered in a dashboard's head, and asks what to compare its resource with", async () => {
    expect(dialog()).toBeNull();
    await open();
    expect(dialog()!.querySelector('h2')!.textContent).toBe(compareHeading('acme/widget'));
    const label = dialog()!.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(input().id);
    expect(label.textContent?.trim()).toBe('Repository URL or owner/repo');
  });

  it('opens the comparison of a repository with another, in any form of Table 4-1', async () => {
    await open();
    await compareWith('https://github.com/Umbrella/Gadget/tree/main');
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith(
      '/-/compare/acme/widget...Umbrella/Gadget',
    );
  });

  it('says why what was typed opens no comparison, and opens none (NFR-UX-06)', async () => {
    await open();
    await compareWith('gitlab.com/umbrella/gadget');
    expect(problem()).toBe(problemMessage({ kind: 'not-github' }, GITHUB_COM));
    expect(input().getAttribute('aria-invalid')).toBe('true');
    await compareWith('umbrella');
    expect(problem()).toBe(anotherKind('repository', GITHUB_COM));
    await compareWith('github.com/ACME/widget');
    expect(problem()).toBe(sameResource('acme/widget'));
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('compares an account with an organization or a user, and not with a repository', async () => {
    fixture.componentInstance.resource.set({ kind: 'organization', org: 'acme' });
    fixture.componentInstance.name.set('acme');
    await fixture.whenStable();
    await open();
    expect(dialog()!.querySelector('label')!.textContent?.trim()).toBe(
      'Organization or user URL or name',
    );
    await compareWith('umbrella/gadget');
    expect(problem()).toBe(anotherKind('account', GITHUB_COM));
    await compareWith('github.com/users/mona');
    expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith('/-/compare/acme...mona');
  });

  // CON-09: on GitHub Enterprise Server, it takes URLs on its host, and says so.
  describe('on GitHub Enterprise Server', () => {
    beforeEach(async () => {
      http.match('/-/api/session');
      TestBed.resetTestingModule();
      await setup('ghe.example.com');
    });

    it('takes URLs on its host alone', async () => {
      await open();
      expect(input().placeholder).toBe('ghe.example.com/owner/repo');
      await compareWith('https://github.com/umbrella/gadget');
      expect(problem()).toBe('BuhTig supports ghe.example.com URLs only.');
      await compareWith('umbrella');
      expect(problem()).toContain('such as ghe.example.com/owner/repo.');
      await compareWith('ghe.example.com/umbrella/gadget');
      expect(navigateByUrl).toHaveBeenCalledExactlyOnceWith(
        '/-/compare/acme/widget...umbrella/gadget',
      );
    });
  });

  it('closes on Cancel, opening nothing', async () => {
    await open();
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Cancel')!
      .click();
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
