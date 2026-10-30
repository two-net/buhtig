import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Clock } from '../format/clock';
import { exactTime, relativeTime } from '../format/format';
import { HeadActions } from './head-actions';
import { OPEN_ON_GITHUB, UPDATED } from './messages';
import { Refresh } from './refresh';

@Component({
  imports: [HeadActions],
  template: `<app-head-actions
    [resource]="{ kind: 'repository', owner: 'Acme', repo: 'Widget' }"
    path="/Acme/Widget"
    [fetchedAt]="fetchedAt()"
    (refreshed)="refreshed = refreshed + 1"
  />`,
})
class Host {
  readonly fetchedAt = signal<Date | undefined>(undefined);
  refreshed = 0;
}

describe('HeadActions', () => {
  const now = new Date('2026-10-22T12:04:30Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const freshness = () => element().querySelector('.freshness')!;

  it('says when the data was fetched from GitHub, once it is known (FR-DATA-06)', async () => {
    expect(freshness().textContent?.trim()).toBe('');
    const fetchedAt = new Date('2026-10-22T12:00:00Z');
    fixture.componentInstance.fetchedAt.set(fetchedAt);
    await fixture.whenStable();
    const time = freshness().querySelector('time')!;
    expect(freshness().querySelector('span')?.firstChild?.textContent?.trim()).toBe(UPDATED);
    expect(time.getAttribute('datetime')).toBe(fetchedAt.toISOString());
    expect(time.querySelector('[role="tooltip"]')?.textContent).toBe(exactTime(fetchedAt));
    expect(time.textContent).toContain(relativeTime(fetchedAt, now));
  });

  it('links to the page on GitHub', () => {
    const link = element().querySelector('a.btn')!;
    expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
      OPEN_ON_GITHUB,
      'https://github.com/Acme/Widget',
    ]);
  });

  it('says when the dashboard was refreshed', () => {
    fixture.debugElement.query(By.directive(Refresh)).componentInstance.refreshed.emit();
    expect(fixture.componentInstance.refreshed).toBe(1);
  });
});
