# BuhTig

BuhTig turns a GitHub repository or organization URL into an animated dashboard. It is
one application plus one PostgreSQL database, configured by one file. What it must do is
in [SRS.md](SRS.md).

- `src/BuhTig`: the server (Rust). It serves the UI, talks to GitHub and PostgreSQL.
- `src/BuhTig.Angular`: the UI (Angular). It is built into the server, not deployed on
  its own.

## Build

```sh
cd src/BuhTig.Angular && npm ci && npm run build
cd ../BuhTig && cargo build --release
```

Build the UI first: a release build embeds it, so `src/BuhTig/target/release/BuhTig` is
the only file to deploy. Cargo warns if the UI has not been built. `npm run build` also
compresses the UI's files, which BuhTig serves compressed, and fails if the home page would
transfer more than its 300 KB budget.

## Run locally

You need PostgreSQL 15 or newer with an empty database, and a config file:

```sh
createdb buhtig
cd src/BuhTig
cp config.example.toml config.toml && chmod 600 config.toml
```

In `config.toml`, set:

- `server.public_url = "http://localhost:8080"`
- `database.url` for your database
- `github.client_id` and `github.client_secret` of a GitHub OAuth app whose callback URL
  is `http://localhost:8080/-/auth/callback`
- `security.encryption_key`, from `openssl rand -base64 32`

Then run `cargo run` and open <http://localhost:8080>. BuhTig creates its tables on the
first start. Nothing else needs setting up.

Debug builds read the UI from `src/BuhTig.Angular/dist` as they serve it. Run
`npm run watch` in `src/BuhTig.Angular` and reload the page to see UI changes.

## Test

- `cargo test` in `src/BuhTig`. The tests start their own PostgreSQL cluster from the
  PostgreSQL 15+ binaries on `PATH` (or `pg_config --bindir`). They never call GitHub:
  tests that need it get a stand-in, `github::stub` (NFR-MNT-03). The only test that calls
  the real GitHub is `#[ignore]`d:
  `cargo test reads_a_public_repository_from_github -- --ignored` runs it.
- `npm test` and `npm run test:scripts` in `src/BuhTig.Angular`.
- **On each release,** add its database to `src/BuhTig/tests/fixtures/schemas`, as the
  README there says, so that the next release is tested upgrading from it.
- **Load test:** `cargo test --release load_test -- --ignored --nocapture` in
  `src/BuhTig`, after building the UI. 100 users at once, half of them signed in, open the
  home page and dashboards served from the cache, with 10,000 users registered. BuhTig
  runs on one worker thread, as on one vCPU. It fails if any answer takes longer than
  300 ms at the 95th percentile, or the process uses more than 1 GB. It takes a few
  minutes, and only a release build says anything about speed.

## Operate

- **Config:** BuhTig reads only its config file, `./config.toml` or the path given with
  `--config`. Restart it after changing the file. `config.example.toml` lists every key and
  its default.
- **TLS:** terminate HTTPS in front of BuhTig, for example in a reverse proxy. BuhTig
  itself listens on plain HTTP at `server.listen`.
- **Compression:** BuhTig compresses what it sends. It serves the UI's files compressed
  with brotli or gzip, as the browser accepts, and gzips other responses of 1 KB or more,
  so the proxy needn't compress anything. The proxy should pass `Accept-Encoding` on, send
  compressed responses as they are, and keep `Vary` if it caches. BuhTig speaks HTTP/1.1,
  over which browsers open at most 6 connections to a host, and a dashboard asks for about
  10 things at once, so have the proxy speak HTTP/2 to browsers.
- **GitHub:** BuhTig only reads from GitHub, through `api.github.com` over HTTPS, and
  signs users in through `github.com`. It checks GitHub's certificate against the root
  certificates built into it, not the host's.
  Requests go through `github.proxy_url` if it is set, and never through a proxy named in
  the environment, so a proxy that inspects TLS does not work. Visitors' requests carry
  the OAuth app's client ID and secret, which earn a higher rate limit than anonymous
  requests. GitHub ignores a client ID it does not know, so check `github.client_id` if
  visitors run into the rate limit soon. Repository dashboards also count issues and pull
  requests with GitHub's search API, which has a separate, much lower rate limit: up to
  four searches per repository per `cache.ttl` (open, merged and closed pull requests, and
  closed issues). When it runs out, the stat cards and the issues and pull requests widget
  show cached figures, or an error until it resets. GitHub
  computes a repository's commit activity when it is first asked for, so its chart may say
  "Calculating on GitHub…" for up to a minute while BuhTig asks again. GitHub does not list
  the contributors of its very largest repositories, and their dashboards say so.
- **Sign-in:** users sign in with their GitHub account. GitHub asks them to let BuhTig
  identify them, and grants it nothing more: no private repositories or organization data,
  and nothing to write. Open BuhTig at `server.public_url`, since a sign-in started at
  another address cannot finish. When `access.allowed_users` lists logins, only those
  users may sign in, and anyone else sees a "not allowed" page. A session ends after
  `auth.session_idle_timeout` without use, `auth.session_max_age` after sign-in, or when
  the user signs out. A user is signed out everywhere once GitHub rejects their sign-in, as
  when they revoke BuhTig's access on GitHub, and everyone is signed out when
  `security.encryption_key` changes. BuhTig sets two cookies: the session's, and one that
  keeps a sign-in's state for 10 minutes. Both are `Secure`, unless `server.public_url` is
  `http://localhost`. Each client may have 10 sign-ins checked with GitHub a minute; past
  that, BuhTig asks them to wait a minute.
- **Personal access tokens:** a signed-in user may save one personal access token in
  Settings, so that their dashboards include the private repositories and organization
  data it can see. No one needs one. BuhTig asks GitHub about each token before it saves
  it, and saves it only if it is valid and belongs to the signed-in user. Each client may
  have 10 tokens checked a minute. Tokens are stored encrypted with
  `security.encryption_key`, and are never shown or logged. When the key changes, users are
  signed out and asked to enter their tokens again. A token that GitHub stops accepting,
  as when it is revoked or expires, is marked invalid: the user's requests go with their
  sign-in again, and BuhTig asks them to replace the token. Replacing or removing a token
  deletes the data cached with it at once.
- **Shortcuts:** for signed-in users, BuhTig remembers the last 20 dashboards they opened,
  only which ones and when, and lets them pin up to 12 with the Pin button in a dashboard's
  header. The home page shows up to 8 of them below the search box, pins first. In
  Settings, users can reorder or unpin their pins and clear their history. Housekeeping
  trims each user's history to 20 entries.
- **Deleting data:** in Settings, once they confirm, signed-in users can delete everything
  BuhTig keeps of theirs: their account, sessions, credentials, the data cached with their
  token, their history and their pins. This signs them out on every browser. BuhTig stays
  among their authorized OAuth apps on GitHub until they revoke it there, which Settings
  links to, since BuhTig changes nothing on GitHub.
- **Access:** in public mode, the default, anyone may open the home page and the
  dashboards of public repositories and organizations, with public data only. Settings,
  shortcuts and refreshing a dashboard need sign-in. With `access.mode = "private"`,
  every page needs sign-in but the sign-in page, the About and Privacy pages and
  `/-/health`: a visitor is sent to sign in, and then back to the page they opened. In
  either mode, private and internal repositories and private organization data are shown
  only to users whose personal access token can see them on GitHub. GitHub says "not
  found" both of what does not exist and of what the viewer may not see, so BuhTig shows
  one "Not found or private" page, which tells the viewer what they can do: sign in, or
  add a token. Someone who loses access on GitHub loses it in BuhTig once their cached
  copy is `cache.ttl` old and GitHub answers again. A signed-in user may refresh a
  dashboard once a minute, so that it asks GitHub at once.
- **Organizations:** an organization's dashboard reads up to `limits.org_repositories` of
  its repositories, those pushed to most recently, 100 per request to GitHub. A larger
  organization's figures cover only those, and its dashboard says so. Its members widget
  shows only members who make their membership public. GitHub doesn't report how many
  there are, so for an organization with more than 24, BuhTig makes one more request to
  count them.
- **Cache:** BuhTig keeps the GitHub data it shows in the database, and serves it for
  `cache.ttl` before it asks GitHub again. While GitHub is unreachable or rate-limited,
  dashboards show the latest data they have, with its age. Data fetched with a user's
  personal access token is shown only to that user. When an organization requires single
  sign-on, or doesn't accept a user's token, the dashboard says so and how to fix it.
- **Visitors:** each visitor may make `limits.visitor_fetches_per_hour` dashboard loads an
  hour that need data from GitHub. Loads served from the cache don't count. While less
  than 10% of visitors' shared GitHub rate limit remains, visitors see cached data only
  until it resets. Signing in lifts both limits, since a signed-in user's requests count
  against their own rate limit. Visitors are told apart by IP address, which BuhTig takes
  from `X-Forwarded-For` only when the request comes from a loopback or private address,
  such as a reverse proxy on the same host or network. Behind a proxy that connects from a
  public address, such as a CDN, or that doesn't set `X-Forwarded-For`, all visitors share
  one limit.
- **Security:** BuhTig refuses a POST, PUT or DELETE that a browser sends from another
  origin's page with `403`. It tells them apart by the `Sec-Fetch-Site` and `Origin`
  headers, compared with `server.public_url`, so a reverse proxy must pass both on
  unchanged. Every response carries a Content Security Policy, under which pages load
  scripts and styles from BuhTig alone, and images from BuhTig and GitHub's avatar host. It
  also carries `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`, and `Strict-Transport-Security` for a
  year when `server.public_url` is `https`. Don't add a policy of your own in the proxy:
  each page has a nonce of its own, which BuhTig's policy names. Errors give their status
  and nothing of how BuhTig works.
- **URLs:** dashboards live at `/{owner}/{repo}` and `/{org}`, as on GitHub, so replacing
  `github.com` with BuhTig's host in a GitHub link opens the matching dashboard. Deeper
  paths, such as `/{owner}/{repo}/pull/42` or `/orgs/{org}/people`, redirect to it. A
  dashboard switches to the names as GitHub spells them, and follows a repository that was
  renamed or transferred. BuhTig's own pages are under `/-/`. What is under `/-/api/` serves
  BuhTig's UI only; it is not a supported API and may change in any release.
- **Link previews:** in public mode, a link to a dashboard unfurls in chat tools with the
  repository's or organization's name and its description on GitHub, if someone opened the
  dashboard within `cache.ttl`. Previews show only public data from the shared cache, and
  BuhTig never asks GitHub for one. In private mode, links have no preview.
- **Motion:** the UI animates, but keeps still for anyone whose browser asks for reduced
  motion, and for everyone when `ui.animations` is `false`. Animations never hold up typing,
  clicking or navigating. Widgets shimmer while their data is on its way. The first time
  each comes into view, its figures count up, its charts draw in and its lists come in one
  item after another. A refresh doesn't play that again.
- **Health:** `GET /-/health` answers `200 ok` while BuhTig can reach its database, and
  `503 unavailable` otherwise. During a database outage, pages show a short "try again"
  notice. BuhTig recovers on its own when the database is back.
- **Logs:** BuhTig logs to stdout at `log.level`: startup, errors, and one line per request
  (method, path, status, duration). Logs never include query strings, cookies or
  credentials.
- **Stop:** on SIGTERM or Ctrl-C, BuhTig stops accepting connections and gives requests in
  flight up to 10 seconds to finish.
- **Upgrade:** replace the binary and restart it. The schema is migrated as BuhTig starts.
  An older BuhTig refuses to start on a schema that a newer one has migrated.
- **Back up:** all state is in the database, so back up the database.
