import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Failure } from '../widget/load';
import { FailurePage } from './failure';
import {
  KEEP_EXPLORING,
  NOTHING_SAVED,
  SEARCH_AGAIN,
  SIGN_IN_WITH_GITHUB,
  TRY_AGAIN,
  TRY_LATER,
  UNAVAILABLE,
  UNREACHABLE,
  VISITORS_HELD,
} from './messages';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [FailurePage],
  template: `<app-failure [failure]="failure()" (retry)="retries = retries + 1" />`,
})
class Host {
  readonly failure = signal<Failure>('github');
  retries = 0;
}

describe('FailurePage', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }])],
    });
    await TestBed.inject(Router).navigateByUrl('/acme/widget/releases');
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** Its heading, what it says, and what the user can do, each where it leads, if anywhere. */
  const page = () => [
    element().querySelector('h1')?.textContent,
    element().querySelector('p')?.textContent,
    [...element().querySelectorAll('.row > *')].map((action) => [
      action.textContent?.trim(),
      action.getAttribute('href'),
    ]),
  ];
  const button = () => element().querySelector('button')!;

  async function failed(failure: Failure): Promise<void> {
    fixture.componentInstance.failure.set(failure);
    await fixture.whenStable();
  }

  it('says GitHub cannot be reached, with nothing saved, and tries again (FR-DATA-05)', () => {
    expect(page()).toEqual([
      UNREACHABLE,
      NOTHING_SAVED,
      [
        [TRY_AGAIN, null],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
    button().click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it("says BuhTig can't reach its database, and tries again", async () => {
    await failed('unavailable');
    expect(page()).toEqual([UNAVAILABLE, TRY_LATER, [[TRY_AGAIN, null]]]);
    button().click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('asks a visitor to sign in once visitors may fetch no more, and come back (FR-DATA-10)', async () => {
    await failed('held');
    expect(page()).toEqual([
      KEEP_EXPLORING,
      VISITORS_HELD,
      [
        [SIGN_IN_WITH_GITHUB, '/-/auth/sign-in?return_to=%2Facme%2Fwidget%2Freleases'],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
    expect(element().querySelector('button')).toBeNull();
  });
});
