# Earlier releases' databases

Each `<version>.sql` here is the database that one earlier BuhTig left: the schema it
created, with a row in every table. `every_earlier_release_upgrades_and_keeps_its_data` in
`tests/migration.rs` loads each dump, starts the BuhTig under test on it, and checks that
the schema becomes exactly what an empty database gets and that no user data is lost
(NFR-MNT-02, FR-DB-02 to FR-DB-04, FR-OPS-03).

`0.1.0.sql` is release 0.1.0's, tagged v0.1.0. `0.1.0-a7c0548.sql` comes from commit
a7c0548, before the release, the last before #23 and #33 changed the schema. That build
records itself as 0.1.0, since the version was never bumped during development, so the dump
records the pre-release `0.1.0-a7c0548` instead, which semver ranks below 0.1.0.

## Adding a release's dump

Do this for each release, once it is tagged, so that the next one is tested against it.

1. Build the release in a worktree of its own:
   `git worktree add --detach ../buhtig-<version> v<version>`, then `cargo build` in its
   `src/BuhTig`.
2. Start a throwaway cluster and create an empty database in it:
   `initdb -D <dir> -U postgres --auth=trust`, then
   `pg_ctl -D <dir> -o "-k '' -c listen_addresses=127.0.0.1 -p 54329" start`, then
   `psql -h 127.0.0.1 -p 54329 -U postgres -c 'CREATE DATABASE fixture'`.
3. Start the release once against that database, with a config file whose `database.url` is
   `postgres://postgres@127.0.0.1:54329/fixture`, and stop it once it logs "listening on".
4. Insert at least one row into every table through `psql`, in one transaction. Leave out
   explicit IDs, so that the identity sequences advance as they do in use. Put expiry and
   fetch times far in the future (such as 2999), so that the housekeeping pass that follows
   startup deletes nothing.
5. Dump it in UTC: `PGTZ=UTC pg_dump -h 127.0.0.1 -p 54329 -U postgres --no-owner
   --no-privileges --inserts fixture`.
6. Remove the lines that bind the dump to one version of PostgreSQL, so that it loads on
   PostgreSQL 15 and later: the `SET` lines, `SELECT pg_catalog.set_config(…)`, and
   `\restrict` and `\unrestrict`. For example:
   `grep -v -E '^(SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | cat -s`.
7. Save it here as `<version>.sql`, with a comment at the top saying where it came from.
