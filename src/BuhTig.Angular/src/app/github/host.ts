import { DOCUMENT, InjectionToken, inject } from '@angular/core';

/** GitHub's own host, BuhTig's unless its operator names another (CON-09). */
export const GITHUB_COM = 'github.com';

/** The `<meta>` that the server puts in the page when `github.host` is not github.com. */
const META = 'meta[name="buhtig-github-host"]';

/**
 * The host of the GitHub that BuhTig reads from, `github.host` in its config file: github.com,
 * or a GitHub Enterprise Server's, in lowercase. The search box takes URLs on it (FR-SRCH-05),
 * and links to GitHub's own pages go there.
 */
export const GITHUB_HOST = new InjectionToken<string>('GitHub host', {
  factory: () =>
    inject(DOCUMENT).head.querySelector(META)?.getAttribute('content')?.trim().toLowerCase() ||
    GITHUB_COM,
});
