import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Announcer, AnnouncerHost } from './announcer';

describe('Announcer (NFR-UX-02)', () => {
  let fixture: ComponentFixture<AnnouncerHost>;
  let announcer: Announcer;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(AnnouncerHost);
    announcer = TestBed.inject(Announcer);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const live = () => (fixture.nativeElement as HTMLElement).querySelector('p')!;

  /** What it says once `ms` have gone by. */
  function after(ms: number): string | null {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
    return live().textContent;
  }

  it('speaks where assistive technology listens, and the eye does not look', () => {
    expect(live().getAttribute('role')).toBe('status');
    expect(live().classList).toContain('sr');
    expect(live().textContent).toBe('');
  });

  it('says what it is told, a moment later', () => {
    announcer.announce('acme/widget has loaded.');
    expect(after(29)).toBe('');
    expect(after(1)).toBe('acme/widget has loaded.');
  });

  it('says the same again, by saying nothing first', () => {
    announcer.announce('Loaded.');
    expect(after(30)).toBe('Loaded.');
    announcer.announce('Loaded.');
    expect(announcer.message()).toBe('');
    expect(after(0)).toBe('');
    expect(after(30)).toBe('Loaded.');
  });
});
