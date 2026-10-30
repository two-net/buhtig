import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Clock } from '../format/clock';
import { relativeTime, timeUntil } from '../format/format';
import {
  AUTHORIZE_SSO,
  AUTHORIZE_TOKEN,
  REPLACE_BEFORE,
  REPLACE_TOKEN,
  SIGN_IN_FOR_FRESH,
  SSO_REQUIRED,
  TOKEN_REFUSED,
  TOKEN_REJECTED,
  heldData,
  staleData,
  tokenExpires,
} from './messages';
import { Notices } from './notices';
import { Denied, Stale } from './resources';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [Notices],
  template: `<app-notices [stale]="stale()" [fetchedAt]="fetchedAt()" [denied]="denied()" />`,
})
class Host {
  readonly stale = signal<Stale | undefined>(undefined);
  readonly fetchedAt = signal<Date | undefined>(undefined);
  readonly denied = signal<Denied | undefined>(undefined);
}

describe('Notices', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl('/acme/widget');
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const notices = () => [...fixture.nativeElement.querySelectorAll('.notice')] as HTMLElement[];
  /** Each notice's text, role and color, and where its link leads. */
  const said = () =>
    notices().map((notice) => [
      notice.textContent?.replace(/\s+/g, ' ').trim(),
      notice.getAttribute('role'),
      [...notice.classList].filter((name) => name !== 'notice').join(' '),
      notice.querySelector('a')?.getAttribute('href'),
    ]);

  /** Answers who is viewing: a signed-in user with `token`, as the server describes it. */
  async function viewer(token: object | null): Promise<void> {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token,
    });
    await fixture.whenStable();
  }

  const token = (status: string, expiresAt: number | null) => ({
    type: 'fine_grained',
    last_four: 'abcd',
    scopes: null,
    expires_at: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    status,
    last_validated_at: null,
  });

  it('says nothing when there is nothing to say', async () => {
    await viewer(token('valid', null));
    fixture.componentInstance.fetchedAt.set(new Date(now - DAY));
    await fixture.whenStable();
    expect(notices()).toEqual([]);
  });

  it("says that GitHub rejected the user's token, and where to replace it (FR-PAT-07)", async () => {
    await viewer(token('invalid', now + DAY));
    expect(said()).toEqual([
      [`${TOKEN_REJECTED} ${REPLACE_TOKEN}`, 'alert', 'crit', '/-/settings'],
    ]);
  });

  it('reminds the user to replace a token that expires within 7 days (FR-PAT-10)', async () => {
    const expiresAt = now + 3 * DAY;
    await viewer(token('valid', expiresAt));
    expect(said()).toEqual([
      [
        `${tokenExpires(timeUntil(new Date(expiresAt), now))} ${REPLACE_BEFORE}`,
        'status',
        '',
        '/-/settings',
      ],
    ]);
  });

  it('says nothing of a token that expires later', async () => {
    await viewer(token('valid', now + 8 * DAY));
    expect(notices()).toEqual([]);
  });

  it('says it shows saved data while GitHub fails, and from when (FR-DATA-05)', async () => {
    fixture.componentInstance.stale.set('github');
    fixture.componentInstance.fetchedAt.set(new Date(now - 2 * 60 * 60 * 1000));
    await fixture.whenStable();
    const age = relativeTime(new Date(now - 2 * 60 * 60 * 1000), now);
    expect(said()).toEqual([[staleData(age), 'status', 'warn', undefined]]);
  });

  it('says it shows saved data while visitors may fetch no more, and to sign in (FR-DATA-10)', async () => {
    fixture.componentInstance.stale.set('held');
    fixture.componentInstance.fetchedAt.set(new Date(now - DAY));
    await fixture.whenStable();
    expect(said()).toEqual([
      [
        `${heldData(relativeTime(new Date(now - DAY), now))} ${SIGN_IN_FOR_FRESH}`,
        'status',
        'warn',
        '/-/auth/sign-in?return_to=%2Facme%2Fwidget',
      ],
    ]);
  });

  it('says nothing of saved data that it cannot date', async () => {
    fixture.componentInstance.stale.set('github');
    await fixture.whenStable();
    expect(notices()).toEqual([]);
  });

  it('says how to get access that GitHub keeps from the viewer (FR-PAT-08)', async () => {
    const sso = 'https://github.com/orgs/acme/sso?authorization_request=abc';
    fixture.componentInstance.denied.set({ reason: 'sso', url: sso });
    await fixture.whenStable();
    expect(said()).toEqual([[`${SSO_REQUIRED} ${AUTHORIZE_SSO}`, 'alert', 'warn', sso]]);

    fixture.componentInstance.denied.set({ reason: 'sso', url: undefined });
    await fixture.whenStable();
    expect(said()).toEqual([
      [`${SSO_REQUIRED} ${AUTHORIZE_TOKEN}`, 'alert', 'warn', 'https://github.com/settings/tokens'],
    ]);

    fixture.componentInstance.denied.set({ reason: 'token' });
    await fixture.whenStable();
    expect(said()).toEqual([[`${TOKEN_REFUSED} ${REPLACE_TOKEN}`, 'alert', 'warn', '/-/settings']]);
  });

  it('says all there is to say, the token first', async () => {
    await viewer(token('invalid', null));
    fixture.componentInstance.stale.set('github');
    fixture.componentInstance.fetchedAt.set(new Date(now - DAY));
    fixture.componentInstance.denied.set({ reason: 'token' });
    await fixture.whenStable();
    expect(said().map(([text]) => text?.slice(0, 20))).toEqual([
      TOKEN_REJECTED.slice(0, 20),
      staleData('').slice(0, 20),
      TOKEN_REFUSED.slice(0, 20),
    ]);
  });
});
