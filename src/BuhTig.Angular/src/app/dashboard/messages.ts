// What a dashboard says of access that GitHub keeps from the viewer, kept apart from its logic
// so that it can be translated (NFR-UX-07). Each message says what happened and what to do next
// (NFR-UX-06).

/** FR-PAT-08: an organization requires single sign-on, before the link to authorize. */
export const SSO_REQUIRED =
  "An organization requires single sign-on for this, and hasn't authorized your GitHub " +
  'access for it yet.';

/** FR-PAT-08: the link to where to authorize, when GitHub says where. */
export const AUTHORIZE_SSO = 'Authorize it on GitHub';

/** FR-PAT-08: the link to where to authorize a token, when GitHub does not say where. */
export const AUTHORIZE_TOKEN = 'Authorize your token for the organization on GitHub';

/** FR-PAT-08: after either link. */
export const THEN_RELOAD = 'then reload this page.';

/** FR-PAT-08: an organization does not let the user's token in. */
export const TOKEN_REFUSED =
  "The organization doesn't accept your personal access token. It may require owners to " +
  'approve fine-grained tokens, or forbid tokens that last too long. Ask an owner, or ' +
  'replace the token.';

export const REPLACE_TOKEN = 'Replace it in Settings';
