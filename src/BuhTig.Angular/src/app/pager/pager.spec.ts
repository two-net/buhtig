import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Pager, pagesAround } from './pager';

describe('Pager', () => {
  let fixture: ComponentFixture<Pager>;
  let chosen: number[];

  beforeEach(async () => {
    fixture = TestBed.createComponent(Pager);
    chosen = [];
    fixture.componentInstance.go.subscribe((index) => chosen.push(index));
    await show(0, 3);
  });

  async function show(index: number, count: number): Promise<void> {
    fixture.componentRef.setInput('index', index);
    fixture.componentRef.setInput('count', count);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const pager = () => element().querySelector('nav.pager');
  const items = () =>
    [...(pager()?.children ?? [])].map((item) =>
      item.classList.contains('gap') ? '…' : item.textContent?.trim(),
    );
  const button = (label: string) =>
    [...element().querySelectorAll('button')].find(
      (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
    )!;

  it('offers Previous, Next, and each page, the one shown marked as current', () => {
    expect(pager()!.getAttribute('aria-label')).toBe('Pages');
    expect(items()).toEqual(['Previous', '1', '2', '3', 'Next']);
    expect(button('Previous').disabled).toBe(true);
    expect(button('Next').disabled).toBe(false);
    expect(pager()!.querySelector('[aria-current="page"]')!.textContent?.trim()).toBe('1');
  });

  it('says which page is chosen, from 0', () => {
    button('Next').click();
    button('Page 3').click();
    expect(chosen).toEqual([1, 2]);
  });

  it('leaves pages out, for the eye alone, and stops at the last', async () => {
    await show(9, 10);
    expect(items()).toEqual(['Previous', '1', '…', '9', '10', 'Next']);
    expect(pager()!.querySelector('.gap')!.getAttribute('aria-hidden')).toBe('true');
    expect(button('Next').disabled).toBe(true);
    button('Previous').click();
    expect(chosen).toEqual([8]);
  });

  it('shows nothing when there is one page', async () => {
    await show(0, 1);
    expect(pager()).toBeNull();
  });
});

describe('pagesAround', () => {
  it('offers every page when there are few', () => {
    expect(pagesAround(0, 1)).toEqual([0]);
    expect(pagesAround(0, 3)).toEqual([0, 1, 2]);
    expect(pagesAround(1, 4)).toEqual([0, 1, 2, 3]);
  });

  it('offers the first and the last, and those next to the page shown, with gaps between', () => {
    expect(pagesAround(0, 10)).toEqual([0, 1, 'gap', 9]);
    expect(pagesAround(5, 10)).toEqual([0, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pagesAround(9, 10)).toEqual([0, 'gap', 8, 9]);
  });

  it('puts a gap where a single page is left out too', () => {
    expect(pagesAround(3, 7)).toEqual([0, 'gap', 2, 3, 4, 'gap', 6]);
    expect(pagesAround(2, 7)).toEqual([0, 1, 2, 3, 'gap', 6]);
  });
});
