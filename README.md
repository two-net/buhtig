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
the only file to deploy. Cargo warns if the UI has not been built.

## Run locally

You need PostgreSQL 15 or newer with an empty database, and a config file:

```sh
createdb buhtig
cd src/BuhTig
cp BuhTig.example.toml BuhTig.toml && chmod 600 BuhTig.toml
```

In `BuhTig.toml`, set:

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
  PostgreSQL 15+ binaries on `PATH` (or `pg_config --bindir`).
- `npm test` in `src/BuhTig.Angular`.

## Operate

- **Config:** BuhTig reads only its config file, `./BuhTig.toml` or the path given with
  `--config`. Restart it after changing the file. `BuhTig.example.toml` lists every key and
  its default.
- **TLS:** terminate HTTPS in front of BuhTig, for example in a reverse proxy. BuhTig
  itself listens on plain HTTP at `server.listen`.
- **GitHub:** BuhTig only reads from GitHub, through `api.github.com` over HTTPS. It
  checks GitHub's certificate against the root certificates built into it, not the host's.
  Requests go through `github.proxy_url` if it is set, and never through a proxy named in
  the environment, so a proxy that inspects TLS does not work. Visitors' requests carry
  the OAuth app's client ID and secret, which earn a higher rate limit than anonymous
  requests. GitHub ignores a client ID it does not know, so check `github.client_id` if
  visitors run into the rate limit soon.
- **Cache:** BuhTig keeps the GitHub data it shows in the database, and serves it for
  `cache.ttl` before it asks GitHub again. While GitHub is unreachable or rate-limited,
  dashboards show the latest data they have, with its age. Data fetched with a user's
  personal access token is shown only to that user.
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
