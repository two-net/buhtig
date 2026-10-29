import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrganizationLastPush } from './last-push';

@Component({
  imports: [OrganizationLastPush],
  template: `<app-organization-last-push [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

describe('OrganizationLastPush', () => {
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

  /** The chart's table, row by row, its headers first. */
  const table = () =>
    [...element().querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );

  /** Each bar, as its label and its figure. */
  const bars = () =>
    [...element().querySelectorAll('li')].map((bar) => [
      bar.querySelector('.label')?.textContent?.trim(),
      bar.querySelector('.value')?.textContent?.replace(/\s+/g, ' ').trim(),
    ]);

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/organizations/acme/last-push').flush(body);
    await fixture.whenStable();
  }

  it('counts the repositories last pushed to in each period, most recent first (FR-ORG-06)', async () => {
    await answer({ last_7_days: 3, last_30_days: 1, last_12_months: 0, older: 12 });
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Last push');
    expect(bars()).toEqual([
      ['Last 7 days', '3 repositories'],
      ['Last 30 days', '1 repository'],
      ['Last 12 months', '0 repositories'],
      ['Older', '12 repositories'],
    ]);
    // None for a period without repositories.
    expect(element().querySelectorAll('.bar')).toHaveLength(3);
  });

  it('says how many were pushed to lately, and lists the periods in a table (NFR-UX-04)', async () => {
    await answer({ last_7_days: 3, last_30_days: 1, last_12_months: 0, older: 12 });
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      '4 of 16 repositories were pushed to in the last 30 days.',
    );
    expect(table()).toEqual([
      ['Last push', 'Repositories'],
      ['Last 7 days', '3'],
      ['Last 30 days', '1'],
      ['Last 12 months', '0'],
      ['Older', '12'],
    ]);

    fixture.componentInstance.org.set('solo');
    await fixture.whenStable();
    http
      .expectOne('/-/api/organizations/solo/last-push')
      .flush({ last_7_days: 0, last_30_days: 1, last_12_months: 0, older: 0 });
    await fixture.whenStable();
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      '1 of 1 repository was pushed to in the last 30 days.',
    );
  });

  it('says when there are no repositories', async () => {
    await answer({ last_7_days: 0, last_30_days: 0, last_12_months: 0, older: 0 });
    expect(element().querySelector('.message')?.textContent?.trim()).toBe('No repositories yet.');
    expect(element().querySelector('ol, button')).toBeNull();
  });
});
