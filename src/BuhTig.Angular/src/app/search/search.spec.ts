import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Mock, MockInstance } from 'vitest';
import { Motion } from '../motion/motion';
import { Search } from './search';

describe('Search', () => {
  let fixture: ComponentFixture<Search>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;
  /** Whether motion is on, as `Motion` would say (FR-ANIM-10). */
  let motion: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    motion = signal(true);
    TestBed.configureTestingModule({
      imports: [Search],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Motion, useValue: { full: motion } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const input = () => element().querySelector('input')!;
  const message = () => element().querySelector('[role="alert"]')?.textContent?.trim();
  const hint = () => element().querySelector('[role="status"]')?.textContent?.trim();

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
  }

  /** Types `text` and presses "Show dashboard", as Enter in the input does. */
  function search(text: string): void {
    type(text);
    element().querySelector('button')!.click();
  }

  const USER_MESSAGE =
    "octocat is a GitHub user, not an organization. BuhTig shows repositories and organizations, so enter one of octocat's repositories, such as octocat/repository-name.";

  it('rejects other hosts inline, without navigating (AC-10)', async () => {
    search('gitlab.com/owner/repo');
    await fixture.whenStable();
    expect(message()).toBe('BuhTig supports github.com URLs only.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('search-message');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('checks names before asking anyone (FR-SRCH-04)', async () => {
    search('https://github.com/-owner/repo');
    await fixture.whenStable();
    expect(message()).toContain('“-owner” is not a GitHub account name.');
    expect(navigate).not.toHaveBeenCalled();
    // `http.verify` checks that nothing was asked.
  });

  it('asks for something to search for', async () => {
    search('  ');
    await fixture.whenStable();
    expect(message()).toBe('Enter a GitHub repository or organization URL.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens a repository's dashboard at once (FR-SRCH-03)", async () => {
    search('https://github.com/owner/repo/tree/main');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/owner/repo'));
    expect(message()).toBeUndefined();
  });

  it("opens an organization's dashboard once the server says it is one", async () => {
    search('github.com/orgs/acme/repositories');
    http.expectOne('/-/api/accounts/acme').flush({ type: 'organization' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/acme'));
  });

  it('says when an account is a user, without navigating (FR-SRCH-06)', async () => {
    search('octocat');
    http.expectOne('/-/api/accounts/octocat').flush({ type: 'user' });
    await vi.waitFor(() => expect(message()).toBe(USER_MESSAGE));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the dashboard anyway when the server cannot tell', async () => {
    search('nobody');
    http.expectOne('/-/api/accounts/nobody').flush(null, { status: 404, statusText: 'Not Found' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/nobody'));

    search('acme');
    http.expectOne('/-/api/accounts/acme').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/acme'));

    search('offline');
    http.expectOne('/-/api/accounts/offline').error(new ProgressEvent('error'));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/offline'));
  });

  it('opens the dashboard anyway when the server takes too long', async () => {
    vi.useFakeTimers();
    search('slow');
    const request = http.expectOne('/-/api/accounts/slow');
    vi.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(request.cancelled).toBe(true);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/slow'));
  });

  it('clears the message as the input is edited', async () => {
    search('gitlab.com/owner/repo');
    await fixture.whenStable();
    expect(message()).toBeDefined();
    type('gitlab.com/owner/rep');
    await fixture.whenStable();
    expect(message()).toBeUndefined();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('ignores what it learns about an account once the input has changed', async () => {
    search('octocat');
    const request = http.expectOne('/-/api/accounts/octocat');
    type('octocat/hello-world');
    request.flush({ type: 'user' });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    expect(message()).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('as the user types (FR-SRCH-09)', () => {
    it('shows the repository the input names, without opening it', async () => {
      type('https://github.com/owner/repo/tree/main');
      await fixture.whenStable();
      expect(hint()).toBe('Repository · owner/repo');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the organization the input names, without asking the server', async () => {
      type('github.com/orgs/acme');
      await fixture.whenStable();
      expect(hint()).toBe('Organization · acme');
      // `http.verify` checks that nothing was asked.
    });

    it('shows why the input is wrong, without marking it invalid until searched for', async () => {
      type('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(hint()).toBe('BuhTig supports github.com URLs only.');
      type('-owner/repo');
      await fixture.whenStable();
      expect(hint()).toContain('“-owner” is not a GitHub account name.');
      expect(message()).toBeUndefined();
      expect(input().hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows nothing while the input is empty or the beginning of a URL', async () => {
      for (const text of ['', '  ', 'https://github.c', 'github.com/', 'git@github.com:']) {
        type(text);
        await fixture.whenStable();
        expect(hint(), text).toBe('');
      }
    });

    it('shows no problem while a URL is typed key by key', async () => {
      for (const url of [
        'https://github.com/owner/repo',
        'git@github.com:owner/repo.git',
        'ssh://git@github.com/owner/repo',
        'github.com/orgs/acme',
      ]) {
        for (let end = 1; end <= url.length; end++) {
          type(url.slice(0, end));
          await fixture.whenStable();
          expect(hint(), url.slice(0, end)).toMatch(/^$|^(Repository|Organization) · /);
        }
      }
    });

    it('shows it at once, with no delay (NFR-PERF-06)', () => {
      type('owner/repo');
      fixture.detectChanges();
      expect(hint()).toBe('Repository · owner/repo');
    });

    it('gives way to the message when searched for, and comes back with the next edit', async () => {
      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(hint()).toBe('');
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      type('github.com/owner/repo');
      await fixture.whenStable();
      expect(message()).toBeUndefined();
      expect(hint()).toBe('Repository · owner/repo');
    });
  });

  describe('keyboard (FR-SRCH-07)', () => {
    function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    }

    /** A new search box, on a desktop or a touch screen. */
    async function load(focusOnDesktop: boolean, desktop: boolean): Promise<HTMLInputElement> {
      vi.stubGlobal('matchMedia', () => ({ matches: desktop }));
      const loaded = TestBed.createComponent(Search);
      loaded.componentRef.setInput('focusOnDesktop', focusOnDesktop);
      await loaded.whenStable();
      return (loaded.nativeElement as HTMLElement).querySelector('input')!;
    }

    it('focuses the input once it is shown on desktop, if asked to', async () => {
      const box = await load(true, true);
      expect(document.activeElement).toBe(box);
    });

    it('does not focus the input on a touch screen, or unless asked to', async () => {
      for (const box of [await load(true, false), await load(false, true), input()]) {
        expect(document.activeElement).not.toBe(box);
      }
    });

    it('focuses the input on /, without typing it', () => {
      const event = press(document.body, '/');
      expect(document.activeElement).toBe(input());
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves / to other fields, to the input itself, and to shortcuts', () => {
      const other = document.createElement('textarea');
      document.body.append(other);
      other.focus();
      expect(press(other, '/').defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(other);
      other.remove();

      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        expect(press(document.body, '/', { [modifier]: true }).defaultPrevented, modifier).toBe(
          false,
        );
      }
      expect(document.activeElement).not.toBe(input());

      input().focus();
      expect(press(input(), '/').defaultPrevented).toBe(false);
    });

    it('clears the input, its hint and its message on Esc', async () => {
      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(message()).toBeDefined();
      press(input(), 'Escape');
      await fixture.whenStable();
      expect(input().value).toBe('');
      expect(hint()).toBe('');
      expect(message()).toBeUndefined();
      expect(input().hasAttribute('aria-invalid')).toBe(false);
    });

    it('ignores what it learns about an account once Esc has cleared the input', async () => {
      search('octocat');
      const request = http.expectOne('/-/api/accounts/octocat');
      press(input(), 'Escape');
      request.flush({ type: 'user' });
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      expect(message()).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("in a dashboard's header (UI-03)", () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('prefill', 'github.com/acme/widget');
      await fixture.whenStable();
    });

    it("is filled in with the dashboard's resource, which it does not repeat below", () => {
      expect(input().value).toBe('github.com/acme/widget');
      expect(hint()).toBe('');
    });

    it('says what it recognizes once edited', async () => {
      type('github.com/acme/gadget');
      await fixture.whenStable();
      expect(hint()).toBe('Repository · acme/gadget');
      type('github.com/acme/widget');
      await fixture.whenStable();
      expect(hint()).toBe('');
    });

    it('has no "Show dashboard", and opens a dashboard as the form is submitted', async () => {
      expect(element().querySelector('button')).toBeNull();
      type('owner/repo');
      element().querySelector('form')!.requestSubmit();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
    });

    it('is filled in anew for another dashboard, without the last message', async () => {
      type('octocat');
      element().querySelector('form')!.requestSubmit();
      http.expectOne('/-/api/accounts/octocat').flush({ type: 'user' });
      await vi.waitFor(() => expect(message()).toBe(USER_MESSAGE));
      fixture.componentRef.setInput('prefill', 'github.com/acme');
      await fixture.whenStable();
      expect(input().value).toBe('github.com/acme');
      expect(message()).toBeUndefined();
      expect(hint()).toBe('');
    });
  });
  describe('motion', () => {
    let animate: Mock<HTMLElement['animate']>;

    beforeEach(() => {
      // jsdom has no Web Animations.
      animate = vi.fn();
      HTMLElement.prototype.animate = animate;
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    });

    /** The transforms that the input was last animated through, and for how long. */
    function animation(): { transforms: unknown[]; duration: unknown } {
      expect(animate.mock.contexts.at(-1)).toBe(input());
      const [keyframes, options] = animate.mock.lastCall!;
      return {
        transforms: (keyframes as Keyframe[]).map((keyframe) => keyframe['transform']),
        duration: (options as KeyframeAnimationOptions).duration,
      };
    }

    it('shakes as it says why it opens no dashboard, each time (FR-ANIM-09)', async () => {
      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(animate).toHaveBeenCalledOnce();
      const { transforms, duration } = animation();
      expect(transforms).toEqual([
        'none',
        'translateX(-6px)',
        'translateX(5px)',
        'translateX(-3px)',
        'translateX(2px)',
        'none',
      ]);
      expect(duration).toBeLessThanOrEqual(300);

      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(animate).toHaveBeenCalledTimes(2);
    });

    it("shakes as it says that an account is a user's", async () => {
      search('octocat');
      http.expectOne('/-/api/accounts/octocat').flush({ type: 'user' });
      await vi.waitFor(() => expect(message()).toBe(USER_MESSAGE));
      expect(animate).toHaveBeenCalledOnce();
    });

    it('does not shake as it opens a dashboard', async () => {
      search('owner/repo');
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/owner/repo'));
      expect(animate).not.toHaveBeenCalled();
    });

    it('glides to where it is from where it was (FR-ANIM-03)', () => {
      vi.spyOn(input(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      const { transforms, duration } = animation();
      expect(transforms).toEqual(['translate(-50px, 250px) scale(1.5, 1.2)', 'none']);
      expect(duration).toBeLessThanOrEqual(400);
    });

    it('can be typed into and searched from while it glides or shakes (FR-ANIM-11)', async () => {
      // Animations that never end, so that nothing waits for them.
      animate.mockReturnValue({ finished: new Promise(() => {}) } as unknown as Animation);
      vi.spyOn(input(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      expect(animate).toHaveBeenCalledTimes(2);

      search('owner/repo');
      expect(navigate).toHaveBeenCalledWith('/owner/repo');
    });

    it('does not glide while it is not laid out', () => {
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      expect(animate).not.toHaveBeenCalled();
    });

    it('neither shakes nor glides without motion (FR-ANIM-10)', async () => {
      motion.set(false);
      search('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      vi.spyOn(input(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
