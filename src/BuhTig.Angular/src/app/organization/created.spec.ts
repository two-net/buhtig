import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrganizationCreated } from './created';

@Component({
  imports: [OrganizationCreated],
  template: `<app-organization-created [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

/** The repositories of `acme` created in each year, as the server gives them: 126 in all. */
const YEARS = [
  { year: 2019, repositories: 1 },
  { year: 2020, repositories: 0 },
  { year: 2021, repositories: 25 },
  { year: 2022, repositories: 100 },
];

describe('OrganizationCreated', () => {
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
  const svg = () => element().querySelector('svg')!;
  const caption = () => element().querySelector('.caption')?.textContent?.trim();
  const bars = () => [...element().querySelectorAll('rect.bar')];
  const columns = () => [...element().querySelectorAll('rect.column')];
  const labels = () =>
    [...element().querySelectorAll('.years span')].map((label) => label.textContent);

  async function answer(years: object[]): Promise<void> {
    http.expectOne('/-/api/organizations/acme/created-per-year').flush({ years });
    await fixture.whenStable();
  }

  it('charts the repositories created each year, scaled to the busiest (FR-ORG-06)', async () => {
    await answer(YEARS);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Created per year');
    expect(columns()).toHaveLength(4);
    // 2020 has none, and so no bar.
    expect(bars().map((bar) => bar.getAttribute('height'))).toEqual(['2', '25', '100']);
    expect(bars()[2].getAttribute('y')).toBe('0');
    expect(caption()).toBe('126 repositories created since 2019');
  });

  it('says what it shows in a sentence, for assistive technology (NFR-UX-04)', async () => {
    await answer(YEARS);
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe(
      '126 repositories created since 2019. The busiest year was 2022, with 100 repositories.',
    );
  });

  it('tells the repositories of the year pointed at, and the total again after', async () => {
    await answer(YEARS);
    columns()[0].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption()).toBe('2019: 1 repository');
    expect(bars()[0].classList.contains('pointed')).toBe(true);
    expect(bars().filter((bar) => bar.classList.contains('pointed'))).toHaveLength(1);

    // A year without repositories too.
    columns()[1].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption()).toBe('2020: 0 repositories');

    svg().dispatchEvent(new Event('pointerleave'));
    await fixture.whenStable();
    expect(caption()).toBe('126 repositories created since 2019');
  });

  it('labels the first and last years', async () => {
    await answer(YEARS);
    expect(labels()).toEqual(['2019', '2022']);
    expect(element().querySelector('.years')?.getAttribute('aria-hidden')).toBe('true');

    fixture.componentInstance.org.set('new');
    await fixture.whenStable();
    http
      .expectOne('/-/api/organizations/new/created-per-year')
      .flush({ years: [{ year: 2026, repositories: 3 }] });
    await fixture.whenStable();
    expect(labels()).toEqual(['2026']);
  });

  it('says when there are no repositories', async () => {
    await answer([]);
    expect(element().querySelector('.message')?.textContent?.trim()).toBe('No repositories yet.');
    expect(element().querySelector('svg, button')).toBeNull();
  });
});
