import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Dated, ParentComparison } from '../dashboard/resources';
import { Load } from '../widget/load';
import { ForkStatus } from './fork-status';

@Component({
  imports: [ForkStatus],
  template: `<app-fork-status name="Acme/Widget" parent="Upstream/Widget" />`,
})
class Host {}

/** How far `Acme/Widget` is from `Upstream/Widget`. */
function compared(aheadBy: number, behindBy: number): Dated<ParentComparison> {
  return { parent: 'Upstream/Widget', aheadBy, behindBy, fetchedAt: undefined, stale: undefined };
}

describe('ForkStatus', () => {
  const state = signal<Load<Dated<ParentComparison>>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    state.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RepositoryData, useValue: { parentComparison: () => ({ state, retry }) } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const standing = () => element().querySelector('.standing')?.textContent?.trim();

  async function show(load: Load<Dated<ParentComparison>>): Promise<void> {
    state.set(load);
    await fixture.whenStable();
  }

  it('shows a placeholder while GitHub answers', () => {
    expect(element().querySelector('.skel')).not.toBeNull();
    expect(element().querySelector('.sr')?.textContent).toBe('Comparing with Upstream/Widget…');
    expect(standing()).toBeUndefined();
  });

  it('says how far ahead of and behind its parent the fork is, the parent named', async () => {
    await show({ status: 'ready', data: compared(3, 12) });
    expect(standing()).toBe('3 commits ahead of and 12 commits behind Upstream/Widget');
    await show({ status: 'ready', data: compared(1, 0) });
    expect(standing()).toBe('1 commit ahead of Upstream/Widget');
    await show({ status: 'ready', data: compared(0, 1_234) });
    expect(standing()).toBe('1,234 commits behind Upstream/Widget');
    expect(element().querySelector('.skel')).toBeNull();
  });

  it('says when the two are even', async () => {
    await show({ status: 'ready', data: compared(0, 0) });
    expect(standing()).toBe('Even with Upstream/Widget');
  });

  it('says when it could not compare them, and tries again (FR-REPO-09)', async () => {
    await show({ status: 'error', failure: 'github' });
    expect(standing()).toBe("Couldn't compare with Upstream/Widget.");
    element().querySelector<HTMLButtonElement>('button')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('links to the comparison of the parent with the fork (FR-CMP-01)', async () => {
    for (const load of [
      { status: 'loading' },
      { status: 'ready', data: compared(3, 12) },
      { status: 'error', failure: 'github' },
    ] as Load<Dated<ParentComparison>>[]) {
      await show(load);
      const link = element().querySelector<HTMLAnchorElement>('a.compare-parent');
      expect([link?.textContent?.trim(), link?.getAttribute('href')]).toEqual([
        'Compare with parent',
        '/-/compare/Upstream/Widget...Acme/Widget',
      ]);
    }
  });
});
