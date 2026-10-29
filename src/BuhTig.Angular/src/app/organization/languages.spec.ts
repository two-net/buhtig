import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { exactNumber } from '../format/format';
import { OrganizationLanguages } from './languages';

@Component({
  imports: [OrganizationLanguages],
  template: `<app-organization-languages [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

describe('OrganizationLanguages', () => {
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
    http.expectOne('/-/api/organizations/acme/languages').flush(body);
    await fixture.whenStable();
  }

  it('counts the repositories of each language, and the rest as Other (FR-ORG-04)', async () => {
    await answer({
      languages: [
        { name: 'Rust', repositories: 12 },
        { name: 'Go', repositories: 1 },
      ],
      other: 3,
    });
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Languages');
    expect(bars()).toEqual([
      ['Rust', '12 repositories'],
      ['Go', '1 repository'],
      ['Other', '3 repositories'],
    ]);
  });

  it('says which language is the most common, and lists them all in a table (NFR-UX-04)', async () => {
    await answer({
      languages: [
        { name: 'Rust', repositories: 1_200 },
        { name: 'Go', repositories: 1 },
      ],
      other: 3,
    });
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      `Rust is the most common primary language, in ${exactNumber(1_200)} of the ` +
        `${exactNumber(1_204)} repositories that have one.`,
    );
    expect(table()).toEqual([
      ['Language', 'Repositories'],
      ['Rust', exactNumber(1_200)],
      ['Go', '1'],
      ['Other', '3'],
    ]);
  });

  it('has no Other when there is no other language', async () => {
    await answer({ languages: [{ name: 'Rust', repositories: 2 }], other: 0 });
    expect(bars()).toEqual([['Rust', '2 repositories']]);
  });

  it('says when no repository has a primary language', async () => {
    await answer({ languages: [], other: 0 });
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(
      'No primary languages yet.',
    );
    expect(element().querySelector('ol, button')).toBeNull();
  });
});
