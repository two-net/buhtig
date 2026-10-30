import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Wordmark } from './wordmark';

describe('Wordmark', () => {
  let fixture: ComponentFixture<Wordmark>;

  async function show(play?: boolean): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Wordmark);
    if (play !== undefined) {
      fixture.componentRef.setInput('play', play);
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('reads as "BuhTig", and leaves its drawing out of what assistive technology reads', async () => {
    const wordmark = await show();
    expect(wordmark.getAttribute('role')).toBe('img');
    expect(wordmark.getAttribute('aria-label')).toBe('BuhTig');
    for (const child of wordmark.children) {
      expect(child.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('sets "BuhTig" letter by letter, above its reflection (CON-10)', async () => {
    const wordmark = await show();
    const letters = [...wordmark.querySelectorAll<HTMLElement>('.letters .ch')];
    expect(letters.map((letter) => letter.textContent)).toEqual(['B', 'u', 'h', 'T', 'i', 'g']);
    // Each in its turn, as they make their entrance.
    expect(letters.map((letter) => letter.style.getPropertyValue('--i'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(wordmark.querySelector('.mirror')?.textContent).toBe('BuhTig');
  });

  it('makes its entrance only when asked to (FR-ANIM-01)', async () => {
    expect((await show()).classList).not.toContain('play');
    expect((await show(false)).classList).not.toContain('play');
    const playing = await show(true);
    expect(playing.classList).toContain('play');
    fixture.componentRef.setInput('play', false);
    await fixture.whenStable();
    expect(playing.classList).not.toContain('play');
  });
});
