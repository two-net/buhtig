import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Entrances } from './entrance';

@Component({ template: '' })
class Page {}

describe('Entrances (FR-ANIM-07)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Page }])],
    });
  });

  afterEach(() => {
    document.head.querySelector('meta[name="buhtig-animations"]')?.remove();
    document.documentElement.classList.remove('still');
    vi.unstubAllGlobals();
  });

  it('lets each widget make its entrance once on a page, and not again after a refresh', async () => {
    await TestBed.inject(Router).navigateByUrl('/acme/widget');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(true);
    expect(entrances.claim('Languages')).toBe(true);
    // As the widgets that a refresh makes anew do.
    expect(entrances.claim('Statistics')).toBe(false);
    expect(entrances.claim('Languages')).toBe(false);
  });

  it('lets them make it again on the page of another navigation', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/acme/widget');
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(true);
    await router.navigateByUrl('/acme/gadget');
    expect(entrances.claim('Statistics')).toBe(true);
    // Back on a dashboard viewed before, too.
    await router.navigateByUrl('/acme/widget');
    expect(entrances.claim('Statistics')).toBe(true);
    expect(entrances.claim('Statistics')).toBe(false);
  });

  it('lets none make it when the server says that ui.animations is off (FR-ANIM-10)', () => {
    const tag = document.createElement('meta');
    tag.name = 'buhtig-animations';
    tag.content = 'off';
    document.head.append(tag);
    expect(TestBed.inject(Entrances).claim('Statistics')).toBe(false);
  });

  it('lets none make it while the browser asks for reduced motion (FR-ANIM-10)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const entrances = TestBed.inject(Entrances);
    expect(entrances.claim('Statistics')).toBe(false);
    expect(entrances.claim('Statistics')).toBe(false);
  });
});
