import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { compactNumber, exactNumber } from '../format/format';
import { Icon } from '../icon/icon';
import { Tab, Tabs } from './tabs';

describe('Tabs', () => {
  let fixture: ComponentFixture<Tabs>;

  const TABS: Tab[] = [
    { label: 'Overview', icon: 'repo', link: '/acme/widget', current: false },
    { label: 'Issues', icon: 'issue', link: '/acme/widget/issues', current: true, count: 12_345 },
    { label: 'Pull requests', icon: 'pr', link: '/acme/widget/pulls', current: false, count: 0 },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Tabs);
    fixture.componentRef.setInput('tabs', TABS);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const links = () => [...element().querySelectorAll('a')];

  it("is the dashboard's navigation, a link for each tab to its own URL (FR-NAV-01)", () => {
    expect(element().querySelector('nav')?.getAttribute('aria-label')).toBe('Dashboard sections');
    expect(
      links().map((link) => [link.querySelector('span')?.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Overview', '/acme/widget'],
      ['Issues', '/acme/widget/issues'],
      ['Pull requests', '/acme/widget/pulls'],
    ]);
  });

  it('marks the tab shown as the current page', () => {
    expect(links().map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('shows the icon of each tab', () => {
    const icons = fixture.debugElement
      .queryAll(By.directive(Icon))
      .map((icon) => (icon.componentInstance as Icon).name());
    expect(icons).toEqual(['repo', 'issue', 'pr']);
  });

  it('counts the items of each tab once known, in short, taking no focus of its own', () => {
    const counters = links().map((link) => link.querySelector('.counter'));
    expect(counters[0]).toBeNull();
    const [issues, pulls] = [counters[1]!, counters[2]!];
    expect(issues.querySelector('[title]')?.textContent).toBe(compactNumber(12_345));
    expect(issues.querySelector('[title]')?.getAttribute('title')).toBe(exactNumber(12_345));
    expect(issues.querySelector('.sr')?.textContent).toBe(exactNumber(12_345));
    expect(issues.querySelector('app-exact, [tabindex]')).toBeNull();
    // None is no unknown.
    expect(pulls.textContent?.trim()).toBe('0');
  });

  it('follows the tab shown and the counts', async () => {
    fixture.componentRef.setInput(
      'tabs',
      TABS.map((tab, index) => ({ ...tab, current: index === 0, count: 7 })),
    );
    await fixture.whenStable();
    expect(links().map((link) => link.getAttribute('aria-current'))).toEqual(['page', null, null]);
    expect(links().map((link) => link.querySelector('.counter')?.textContent?.trim())).toEqual([
      '7',
      '7',
      '7',
    ]);
  });
});
