import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { compactNumber, exactNumber } from '../format/format';
import { OrganizationTopRepositories } from './top-repositories';

@Component({
  imports: [OrganizationTopRepositories],
  template: `<app-organization-top-repositories [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

describe('OrganizationTopRepositories', () => {
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

  const element = () => fixture.nativeElement as HTMLElement;

  /** The chart's table, row by row, its headers first. */
  const table = () =>
    [...element().querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
  const links = () =>
    [...element().querySelectorAll('a.label')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(org: string, repositories: object[]): Promise<void> {
    http.expectOne(`/-/api/organizations/${org}/top-repositories`).flush({ repositories });
    await fixture.whenStable();
  }

  it('shows the repositories with the most stars, each opening its dashboard (FR-ORG-05)', async () => {
    await answer('acme', [
      { name: 'widget', stars: 1_200 },
      { name: 'gadget', stars: 1 },
    ]);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Top repositories');
    expect(links()).toEqual([
      ['widget', '/acme/widget'],
      ['gadget', '/acme/gadget'],
    ]);
    expect([...element().querySelectorAll('.value')].map(shown)).toEqual([
      `${compactNumber(1_200)} stars`,
      '1 star',
    ]);
  });

  it('says which has the most stars, and lists them all in a table (NFR-UX-04)', async () => {
    await answer('acme', [
      { name: 'widget', stars: 1_200 },
      { name: 'gadget', stars: 1 },
    ]);
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      `widget has the most stars, ${exactNumber(1_200)}.`,
    );
    expect(table()).toEqual([
      ['Repository', 'Stars'],
      ['widget', exactNumber(1_200)],
      ['gadget', '1'],
    ]);
  });

  it('leaves out names that no repository can have, and moves with the organization', async () => {
    await answer('acme', [
      { name: 'a b', stars: 5 },
      { name: 'a/b', stars: 4 },
      { name: 'widget', stars: 3 },
    ]);
    expect(links()).toEqual([['widget', '/acme/widget']]);

    fixture.componentInstance.org.set('other');
    await fixture.whenStable();
    await answer('other', [{ name: 'gizmo', stars: 2 }]);
    expect(links()).toEqual([['gizmo', '/other/gizmo']]);
  });

  it('says when no repository has stars', async () => {
    await answer('acme', []);
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(
      'No starred repositories yet.',
    );
    expect(element().querySelector('ol, button')).toBeNull();
  });
});
