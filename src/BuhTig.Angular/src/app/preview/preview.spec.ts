import { Component, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { dropPreviewOnNavigation } from './preview';

@Component({ template: '' })
class Blank {}

describe('dropPreviewOnNavigation', () => {
  const tags = () =>
    [...document.head.querySelectorAll('meta[content]')].map((tag) => tag.getAttribute('content'));

  beforeEach(() => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="description" content="Widgets">' +
        '<meta property="og:title" content="acme/widget">' +
        '<meta name="twitter:card" content="summary">' +
        '<meta name="color-scheme" content="light dark">',
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideAppInitializer(dropPreviewOnNavigation),
      ],
    });
  });

  afterEach(() => {
    document.head.querySelectorAll('meta[content]').forEach((tag) => tag.remove());
  });

  it("keeps the server's preview on the page it served, and drops it on leaving (FR-NAV-06)", async () => {
    const harness = await RouterTestingHarness.create('/acme/widget');
    expect(tags()).toEqual(['Widgets', 'acme/widget', 'summary', 'light dark']);
    await harness.navigateByUrl('/acme/gadget');
    expect(tags()).toEqual(['light dark']);
  });
});
