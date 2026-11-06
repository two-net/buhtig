import { Component, DOCUMENT, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { Known } from '../search/parse';
import { Toasts } from '../toast/toasts';
import { COPY_FAILED, cardAlt, copiedCard } from './messages';
import { ShareCard, cardMarkdown } from './share-card';

@Component({
  imports: [ShareCard],
  template: `<app-share-card [resource]="resource()" (closed)="closed = closed + 1" />`,
})
class Host {
  readonly resource = signal<Known>({ kind: 'repository', owner: 'Acme', repo: 'Widget' });
  closed = 0;
}

describe('ShareCard', () => {
  let fixture: ComponentFixture<Host>;
  let writeText: Mock<(text: string) => Promise<void>>;

  beforeEach(async () => {
    writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const markdown = () => element().querySelector('textarea')!;
  const origin = () => TestBed.inject(DOCUMENT).location.origin;
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => [toast.message, toast.icon]);

  async function copy(): Promise<void> {
    element().querySelector<HTMLButtonElement>('button.primary')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  it('links the card to the dashboard, in Markdown (FR-NAV-08)', () => {
    expect(cardMarkdown('octo', 'https://buhtig.example.com')).toBe(
      '[![octo on BuhTig](https://buhtig.example.com/-/preview/octo.svg)](https://buhtig.example.com/octo)',
    );
    expect(cardMarkdown('Acme/Widget', 'https://buhtig.example.com')).toBe(
      '[![Acme/Widget on BuhTig](https://buhtig.example.com/-/preview/Acme/Widget.svg)]' +
        '(https://buhtig.example.com/Acme/Widget)',
    );
  });

  it('shows the card, and its Markdown on this BuhTig, to select (FR-NAV-07)', async () => {
    const image = element().querySelector('img')!;
    expect([image.getAttribute('src'), image.getAttribute('alt')]).toEqual([
      '/-/preview/Acme/Widget.svg',
      cardAlt('Acme/Widget'),
    ]);
    expect(markdown().value).toBe(cardMarkdown('Acme/Widget', origin()));
    expect(markdown().readOnly).toBe(true);

    fixture.componentInstance.resource.set({ kind: 'organization', org: 'octo' });
    await fixture.whenStable();
    expect(image.getAttribute('src')).toBe('/-/preview/octo.svg');
    expect(markdown().value).toBe(cardMarkdown('octo', origin()));
  });

  it('copies the Markdown, says so, and closes', async () => {
    await copy();
    expect(writeText).toHaveBeenCalledWith(cardMarkdown('Acme/Widget', origin()));
    expect(toasts()).toEqual([[copiedCard('Acme/Widget'), 'check']]);
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('says beside the Markdown when the browser will not copy it (NFR-UX-06)', async () => {
    writeText.mockReturnValue(Promise.reject(new Error('Not allowed')));
    await copy();
    const problem = element().querySelector('.field-msg.err')!;
    expect(problem.textContent?.trim()).toBe(COPY_FAILED);
    expect(markdown().getAttribute('aria-describedby')).toBe(problem.id);
    expect(toasts()).toEqual([]);
    expect(fixture.componentInstance.closed).toBe(0);
  });

  it('says so too where the browser has no clipboard, as over plain HTTP', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    await copy();
    expect(element().querySelector('.field-msg.err')?.textContent?.trim()).toBe(COPY_FAILED);
  });
});
