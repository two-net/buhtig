import { TestBed } from '@angular/core/testing';
import { Wordmark } from './wordmark';

describe('Wordmark', () => {
  const element = () => {
    const fixture = TestBed.createComponent(Wordmark);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('reads as "BuhTig", and leaves its drawing out of what assistive technology reads', () => {
    const wordmark = element();
    expect(wordmark.textContent).toBe('BuhTig');
    expect(wordmark.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws "Buh" in the color of the text around it and "Tig" in the accent (CON-10)', () => {
    const paths = [...element().querySelectorAll('svg path')].map((path) => path.classList.value);
    expect(paths).toEqual(['ink', 'accent']);
  });
});
