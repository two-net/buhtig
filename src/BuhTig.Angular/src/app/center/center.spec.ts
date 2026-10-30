import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Icon, IconName } from '../icon/icon';
import { Center } from './center';

@Component({
  imports: [Center],
  template: `
    <app-center [icon]="icon()" heading="Page not found" text="BuhTig has no page at this address.">
      <div class="row"><a href="/">Search again</a></div>
    </app-center>
  `,
})
class Host {
  readonly icon = signal<IconName>('question');
}

describe('Center', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const icon = () =>
    (fixture.debugElement.query(By.directive(Icon)).componentInstance as Icon).name();

  it('heads the page with its message, which the page can focus', () => {
    const heading = element().querySelector('.center h1')!;
    expect(heading.textContent).toBe('Page not found');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(element().querySelector('.center p')?.textContent).toBe(
      'BuhTig has no page at this address.',
    );
  });

  it('shows its icon above', async () => {
    expect(icon()).toBe('question');
    fixture.componentInstance.icon.set('lock');
    await fixture.whenStable();
    expect(icon()).toBe('lock');
  });

  it('shows what the user can do below, in rows', () => {
    const row = element().querySelector('.center > .row')!;
    expect(row.previousElementSibling?.tagName).toBe('P');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/');
  });
});
