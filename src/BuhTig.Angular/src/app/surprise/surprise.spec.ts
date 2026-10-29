import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { Surprise } from './surprise';

describe('Surprise', () => {
  let fixture: ComponentFixture<Surprise>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Surprise],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Surprise);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const button = () => (fixture.nativeElement as HTMLElement).querySelector('button');
  const slot = () => (fixture.nativeElement as HTMLElement).querySelector('.slot');

  it('keeps its place while the server picks, so that nothing moves once it is there', async () => {
    expect(button()).toBeNull();
    expect(slot()?.getAttribute('aria-hidden')).toBe('true');
    http.expectOne('/-/api/surprise').flush({ name: 'owner/repo' });
    await fixture.whenStable();
    expect(slot()).toBeNull();
    expect(button()).not.toBeNull();
  });

  it('is hidden while the shared cache holds no repository (FR-SRCH-10)', async () => {
    http.expectOne('/-/api/surprise').flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(button()).toBeNull();
    expect(slot()).toBeNull();
  });

  it('is hidden when the server cannot say', async () => {
    expect(button()).toBeNull();
    http
      .expectOne('/-/api/surprise')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    expect(button()).toBeNull();
  });

  it('opens the dashboard of the repository the server picked (FR-SRCH-10)', async () => {
    http.expectOne('/-/api/surprise').flush({ name: 'owner/repo' });
    await fixture.whenStable();
    expect(button()!.textContent?.trim()).toBe('Surprise me');
    // It does not submit the search box's form, which it sits in.
    expect(button()!.type).toBe('button');
    button()!.click();
    expect(navigate).toHaveBeenCalledWith('/owner/repo');
  });
});
