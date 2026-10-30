import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import type { Mock, MockInstance } from 'vitest';
import { Icon } from '../icon/icon';
import { Motion } from '../motion/motion';
import { LABEL, PLACEHOLDERS } from './messages';
import { Search, SearchVariant } from './search';
import { Shortcut } from './shortcut';

describe('Search', () => {
  let fixture: ComponentFixture<Search>;
  let navigate: MockInstance<Router['navigateByUrl']>;
  /** Whether motion is on, as `Motion` would say (FR-ANIM-10). */
  let motion: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    motion = signal(true);
    TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideRouter([]), { provide: Motion, useValue: { full: motion } }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const input = () => element().querySelector('input')!;
  const box = () => element().querySelector<HTMLElement>('.search')!;
  const said = () => element().querySelector<HTMLElement>('.search-msg')!;
  const message = () => element().querySelector('[role="alert"]')?.textContent?.trim();
  /** What the input names as the user types, such as "Repository · owner/repo", or why not. */
  const hint = () => {
    const status = element().querySelector('[role="status"]');
    return (
      status &&
      [...status.children]
        .map((child) => child.textContent?.trim())
        .filter(Boolean)
        .join(' · ')
    );
  };
  /** The names of the icons that the hint or message shows. */
  const icons = () =>
    fixture.debugElement
      .queryAll(By.css('.search-msg app-icon'))
      .map((icon) => (icon.componentInstance as Icon).name());
  const submit = () => element().querySelector<HTMLButtonElement>('button[type="submit"]');
  const clearButton = () =>
    element().querySelector<HTMLButtonElement>('button[aria-label="Clear"]');

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
  }

  /** Types `text` and presses "Show dashboard", as Enter in the input does. */
  async function search(text: string): Promise<void> {
    type(text);
    submit()!.click();
    await fixture.whenStable();
  }

  it('is a search form of one input, named for assistive technology', () => {
    expect(element().querySelector('form')?.getAttribute('role')).toBe('search');
    expect(input().getAttribute('aria-label')).toBe(LABEL);
    expect(input().getAttribute('aria-describedby')).toBe(said().id);
    expect(input().getAttribute('inputmode')).toBe('url');
    expect(input().getAttribute('autocomplete')).toBe('off');
    expect(input().getAttribute('spellcheck')).toBe('false');
    // Each box has its own message, as there may be two on a page.
    const other = TestBed.createComponent(Search);
    other.detectChanges();
    expect((other.nativeElement as HTMLElement).querySelector('.search-msg')!.id).not.toBe(
      said().id,
    );
  });

  it('rejects other hosts inline, without navigating (AC-10)', async () => {
    await search('gitlab.com/owner/repo');
    expect(message()).toBe('BuhTig supports github.com URLs only.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(said().classList).toContain('err');
    expect(icons()).toEqual(['alert']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('checks names before going anywhere (FR-SRCH-04)', async () => {
    await search('https://github.com/-owner/repo');
    expect(message()).toContain('“-owner” is not a GitHub account name.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('asks for something to search for', async () => {
    await search('  ');
    expect(message()).toBe('Paste a GitHub repository or organization URL.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('focuses the input as it says why it opens no dashboard', async () => {
    submit()!.focus();
    await search('gitlab.com/owner/repo');
    expect(document.activeElement).toBe(input());
  });

  it("opens a repository's dashboard at once (FR-SRCH-03)", async () => {
    await search('https://github.com/owner/repo/tree/main');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
    expect(message()).toBeUndefined();
  });

  it("opens an organization's dashboard at once, from a name alone too (FR-SRCH-06)", async () => {
    await search('github.com/orgs/acme/repositories');
    expect(navigate).toHaveBeenLastCalledWith('/acme');
    // Whether it is a user's, the dashboard tells.
    await search('octocat');
    expect(navigate).toHaveBeenLastCalledWith('/octocat');
    expect(message()).toBeUndefined();
  });

  it('opens a dashboard as the form is submitted, as Enter does', async () => {
    type('owner/repo');
    element().querySelector('form')!.requestSubmit();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
  });

  it('clears the message as the input is edited', async () => {
    await search('gitlab.com/owner/repo');
    expect(message()).toBeDefined();
    type('gitlab.com/owner/rep');
    await fixture.whenStable();
    expect(message()).toBeUndefined();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('opens a dashboard after a message, once the input names one', async () => {
    await search('gitlab.com/owner/repo');
    await search('github.com/owner/repo');
    expect(message()).toBeUndefined();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
  });

  describe('as the user types (FR-SRCH-09)', () => {
    it('shows the repository the input names, without opening it', async () => {
      type('https://github.com/owner/repo/tree/main');
      await fixture.whenStable();
      expect(hint()).toBe('Repository · owner/repo');
      expect(icons()).toEqual(['repo']);
      expect(said().classList).not.toContain('err');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the organization the input names', async () => {
      type('github.com/orgs/acme');
      await fixture.whenStable();
      expect(hint()).toBe('Organization · acme');
      expect(icons()).toEqual(['org']);
    });

    it('shows why the input is wrong, without marking it invalid until searched for', async () => {
      type('gitlab.com/owner/repo');
      await fixture.whenStable();
      expect(hint()).toBe('BuhTig supports github.com URLs only.');
      expect(icons()).toEqual(['alert']);
      expect(said().classList).toContain('err');
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
        expect(said().classList, text).toContain('blank');
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
      await search('gitlab.com/owner/repo');
      expect(element().querySelector('[role="status"]')).toBeNull();
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      type('github.com/owner/repo');
      await fixture.whenStable();
      expect(message()).toBeUndefined();
      expect(hint()).toBe('Repository · owner/repo');
    });
  });

  describe('✕ and Esc (FR-SRCH-07)', () => {
    it('offers ✕ once there is something to clear', async () => {
      expect(clearButton()).toBeNull();
      type('owner/repo');
      await fixture.whenStable();
      expect(clearButton()?.getAttribute('type')).toBe('button');
    });

    it('clears the input, its hint and its message with ✕, and keeps the focus in it', async () => {
      await search('gitlab.com/owner/repo');
      clearButton()!.focus();
      clearButton()!.click();
      await fixture.whenStable();
      expect(input().value).toBe('');
      expect(hint()).toBe('');
      expect(message()).toBeUndefined();
      expect(clearButton()).toBeNull();
      expect(document.activeElement).toBe(input());
      expect(navigate).not.toHaveBeenCalled();
    });

    it('clears the input, its hint and its message on Esc', async () => {
      await search('gitlab.com/owner/repo');
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(input().value).toBe('');
      expect(hint()).toBe('');
      expect(message()).toBeUndefined();
      expect(input().hasAttribute('aria-invalid')).toBe(false);
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
      const shown = await load(true, true);
      expect(document.activeElement).toBe(shown);
    });

    it('does not focus the input on a touch screen, or unless asked to', async () => {
      for (const shown of [await load(true, false), await load(false, true), input()]) {
        expect(document.activeElement).not.toBe(shown);
      }
    });

    it('focuses the input on /, without typing it', () => {
      const event = press(document.body, '/');
      expect(document.activeElement).toBe(input());
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves / be once the user has turned it off (WCAG 2.1.4)', () => {
      const shortcut = TestBed.inject(Shortcut);
      shortcut.set(false);
      try {
        const event = press(document.body, '/');
        expect(document.activeElement).not.toBe(input());
        expect(event.defaultPrevented).toBe(false);

        shortcut.set(true);
        press(document.body, '/');
        expect(document.activeElement).toBe(input());
      } finally {
        shortcut.set(true);
      }
    });

    it('leaves / to another search box on the page, if asked to', async () => {
      fixture.componentRef.setInput('slash', false);
      await fixture.whenStable();
      const event = press(document.body, '/');
      expect(document.activeElement).not.toBe(input());
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves / to other fields, to the input itself, and to shortcuts', () => {
      for (const tag of ['textarea', 'input', 'select']) {
        const other = document.createElement(tag);
        document.body.append(other);
        other.focus();
        expect(press(other, '/').defaultPrevented, tag).toBe(false);
        expect(document.activeElement).toBe(other);
        other.remove();
      }

      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        expect(press(document.body, '/', { [modifier]: true }).defaultPrevented, modifier).toBe(
          false,
        );
      }
      expect(document.activeElement).not.toBe(input());

      input().focus();
      expect(press(input(), '/').defaultPrevented).toBe(false);
    });

    it('leaves / that something else has handled already', () => {
      const handled = (event: Event) => event.preventDefault();
      document.body.addEventListener('keydown', handled);
      try {
        press(document.body, '/');
        expect(document.activeElement).not.toBe(input());
      } finally {
        document.body.removeEventListener('keydown', handled);
      }
    });

    it('takes no other key', () => {
      expect(press(document.body, 'k').defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(input());
    });
  });

  describe('where it is', () => {
    async function at(variant: SearchVariant): Promise<void> {
      fixture.componentRef.setInput('variant', variant);
      await fixture.whenStable();
    }

    it('offers "Show dashboard" on the home pages (UI-02)', async () => {
      for (const variant of ['hero', 'dash'] as const) {
        await at(variant);
        expect(submit()?.textContent?.trim(), variant).toBe('Show dashboard');
        expect(element().querySelector('kbd'), variant).toBeNull();
        expect(input().placeholder, variant).toBe(PLACEHOLDERS.hero);
      }
    });

    it('says less in its placeholder on a narrow screen', () => {
      vi.stubGlobal('innerWidth', 400);
      const narrow = TestBed.createComponent(Search);
      narrow.detectChanges();
      expect((narrow.nativeElement as HTMLElement).querySelector('input')!.placeholder).toBe(
        PLACEHOLDERS.narrow,
      );
    });

    it('is compact in a header, with / for its key (UI-03)', async () => {
      await at('header');
      expect(submit()).toBeNull();
      expect(element().querySelector('button')).toBeNull();
      const key = element().querySelector('kbd')!;
      expect(key.textContent).toBe('/');
      expect(key.getAttribute('aria-hidden')).toBe('true');
      expect(input().placeholder).toBe('Type / to open a dashboard');
    });
  });

  describe("in a dashboard's header (UI-03)", () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('variant', 'header');
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

    it('opens a dashboard as the form is submitted', async () => {
      type('owner/repo');
      element().querySelector('form')!.requestSubmit();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
    });

    it('is filled in anew for another dashboard, without the last message', async () => {
      type('gitlab.com/acme');
      element().querySelector('form')!.requestSubmit();
      await fixture.whenStable();
      expect(message()).toBe('BuhTig supports github.com URLs only.');
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

    /** The transforms that the box was last animated through, and for how long. */
    function animation(): { transforms: unknown[]; duration: unknown } {
      expect(animate.mock.contexts.at(-1)).toBe(box());
      const [keyframes, options] = animate.mock.lastCall!;
      return {
        transforms: (keyframes as Keyframe[]).map((keyframe) => keyframe['transform']),
        duration: (options as KeyframeAnimationOptions).duration,
      };
    }

    it('shakes as it says why it opens no dashboard, each time (FR-ANIM-09)', async () => {
      await search('gitlab.com/owner/repo');
      expect(animate).toHaveBeenCalledOnce();
      const { transforms, duration } = animation();
      expect(transforms).toEqual([
        'none',
        'translateX(-7px)',
        'translateX(6px)',
        'translateX(-4px)',
        'translateX(3px)',
        'none',
      ]);
      expect(duration).toBeLessThanOrEqual(300);

      await search('gitlab.com/owner/repo');
      expect(animate).toHaveBeenCalledTimes(2);
    });

    it('does not shake as it opens a dashboard', async () => {
      await search('owner/repo');
      expect(navigate).toHaveBeenCalledWith('/owner/repo');
      expect(animate).not.toHaveBeenCalled();
    });

    it('tells where its box is, to glide from on the next page', () => {
      const rect = new DOMRect(100, 300, 600, 48);
      vi.spyOn(box(), 'getBoundingClientRect').mockReturnValue(rect);
      expect(fixture.componentInstance.bounds()).toBe(rect);
    });

    it('glides to where it is from where it was (FR-ANIM-03)', () => {
      vi.spyOn(box(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      const { transforms, duration } = animation();
      expect(transforms).toEqual(['translate(-50px, 250px) scale(1.5, 1.2)', 'none']);
      expect(duration).toBeLessThanOrEqual(400);
    });

    it('can be typed into and searched from while it glides or shakes (FR-ANIM-11)', async () => {
      // Animations that never end, so that nothing waits for them.
      animate.mockReturnValue({ finished: new Promise(() => {}) } as unknown as Animation);
      vi.spyOn(box(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      await search('gitlab.com/owner/repo');
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      expect(animate).toHaveBeenCalledTimes(2);

      await search('owner/repo');
      expect(navigate).toHaveBeenCalledWith('/owner/repo');
    });

    it('does not glide while it is not laid out', () => {
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      expect(animate).not.toHaveBeenCalled();
    });

    it('neither shakes nor glides without motion (FR-ANIM-10)', async () => {
      motion.set(false);
      await search('gitlab.com/owner/repo');
      expect(message()).toBe('BuhTig supports github.com URLs only.');
      vi.spyOn(box(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 40));
      fixture.componentInstance.glideFrom(new DOMRect(50, 300, 600, 48));
      expect(animate).not.toHaveBeenCalled();
    });

    it('says why it opens no dashboard where the browser cannot animate, as jsdom', async () => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      await search('gitlab.com/owner/repo');
      expect(message()).toBe('BuhTig supports github.com URLs only.');
    });
  });
});
