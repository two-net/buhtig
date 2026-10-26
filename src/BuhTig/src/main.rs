mod accounts;
mod auth;
mod cache;
mod config;
mod cookies;
mod crypto;
mod db;
mod entity;
mod github;
mod health;
mod housekeeping;
mod navigation;
mod organizations;
mod preview;
mod repositories;
mod session;
mod surprise;
mod throttle;
mod tokens;
mod ui;
mod visitors;
mod web;

// The integration tests' PostgreSQL cluster, for unit tests that need a database.
#[cfg(test)]
#[path = "../tests/support/cluster.rs"]
mod test_cluster;
#[cfg(test)]
mod test_log;

use std::env;
use std::ffi::OsString;
use std::io::IsTerminal;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use tracing::{debug, error, info, warn};

use crate::auth::Auth;
use crate::cache::Cache;
use crate::config::{AccessMode, Config, LogLevel};
use crate::crypto::Sealer;
use crate::health::Health;
use crate::preview::Previews;
use crate::session::Sessions;
use crate::tokens::Tokens;

/// Where the config file is read from unless `--config` says otherwise (FR-CFG-01).
const DEFAULT_CONFIG_PATH: &str = "BuhTig.toml";

/// How long requests in flight may take to finish once BuhTig is asked to stop
/// (FR-OPS-05).
const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

const USAGE: &str = "\
Usage: BuhTig [--config <path>]

Options:
  -c, --config <path>  Read settings from <path> instead of ./BuhTig.toml
  -h, --help           Print this help
  -V, --version        Print the version";

fn main() -> ExitCode {
    let removed = clear_environment();

    let config_path = match parse_args(env::args_os().skip(1)) {
        Ok(Command::Run { config }) => config,
        Ok(Command::Help) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Ok(Command::Version) => {
            println!("BuhTig {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("error: {message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };

    let config = match Config::load(&config_path) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::FAILURE;
        }
    };

    init_logging(config.log.level);
    debug!(
        names = ?removed,
        "removed environment variables; settings come only from the config file"
    );
    match config::readable_by_others(&config_path) {
        Ok(false) => {}
        Ok(true) => warn!(
            "config file {} can be read by other accounts; restrict it with `chmod 600`",
            config_path.display()
        ),
        Err(error) => warn!(
            "cannot check who can read config file {}: {error}",
            config_path.display()
        ),
    }
    info!(
        version = env!("CARGO_PKG_VERSION"),
        access_mode = %config.access.mode,
        config = %config_path.display(),
        "starting BuhTig"
    );

    // Built by hand rather than with `#[tokio::main]` so that its threads start only
    // after `clear_environment`.
    match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime.block_on(serve(config)),
        Err(error) => {
            error!("cannot start the async runtime: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn serve(config: Config) -> ExitCode {
    // FR-DB-02, FR-DB-05: the schema is migrated before BuhTig listens, and a failure
    // stops it before it serves anything.
    let db = match db::connect(&config.database).await {
        Ok(db) => db,
        Err(error) => {
            error!("{error}");
            return ExitCode::FAILURE;
        }
    };
    match db::migrate(&db).await {
        Ok(migration) => info!("{migration}"),
        Err(error) => {
            error!("{error}");
            return ExitCode::FAILURE;
        }
    }
    let github = match github::Client::new(&config.github) {
        Ok(github) => Arc::new(github),
        Err(error) => {
            error!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let cache = Arc::new(Cache::new(
        db.clone(),
        github.clone(),
        &config.cache,
        &config.limits,
    ));
    // FR-NAV-06. In private mode, visitors see no dashboard (FR-ACC-03), nor a preview.
    let previews = (config.access.mode == AccessMode::Public)
        .then(|| Previews::new(cache.clone(), config.server.public_url.clone()));
    // One for sign-in credentials and PATs alike (DR-03).
    let sealer = Arc::new(Sealer::new(config.security.encryption_key.expose()));
    let sessions = Arc::new(Sessions::new(
        db.clone(),
        sealer.clone(),
        session::Settings {
            idle_timeout: config.auth.session_idle_timeout,
            max_age: config.auth.session_max_age,
            allowed_users: config.access.allowed_users.clone(),
            secure: config.server.public_url.scheme() == "https",
        },
    ));
    let tokens = Arc::new(Tokens::new(db.clone(), sealer, github.clone()));
    let auth = Arc::new(Auth::new(
        sessions.clone(),
        github,
        config.server.public_url.clone(),
    ));
    let app = web::router(
        Arc::new(Health::new(db.clone())),
        cache,
        previews,
        sessions,
        auth,
        tokens,
    );

    let listen = config.server.listen;
    let listener = match tokio::net::TcpListener::bind(listen).await {
        Ok(listener) => listener,
        Err(error) => {
            error!("cannot listen on {listen} (server.listen): {error}");
            return ExitCode::FAILURE;
        }
    };
    info!(
        "listening on http://{}",
        listener.local_addr().unwrap_or(listen)
    );
    // FR-DB-08. Started after the line above, so that its first pass logs after it.
    let housekeeping = housekeeping::spawn(
        db.clone(),
        housekeeping::Settings {
            session_idle_timeout: config.auth.session_idle_timeout,
            session_max_age: config.auth.session_max_age,
            cache_retention: config.cache.retention,
        },
    );
    let served = web::serve(
        listener,
        app,
        web::shutdown_signal(SHUTDOWN_GRACE),
        SHUTDOWN_GRACE,
    )
    .await;

    // A pass cut short here rolls back, and the next start runs a new one.
    housekeeping.abort();
    // So that PostgreSQL sees BuhTig leave rather than lose its connections. A request
    // still running past the grace period may hold one, so this does not wait for long.
    let _ = tokio::time::timeout(Duration::from_secs(1), db.close()).await;
    match served {
        Ok(()) => {
            info!("stopped");
            ExitCode::SUCCESS
        }
        Err(error) => {
            error!("server stopped: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Removes every environment variable and returns their names (FR-CFG-02, AC-07).
///
/// Settings come only from the config file, but libraries read variables on their own:
/// PostgreSQL clients read `PG*`, HTTP clients `HTTPS_PROXY`, tokio `TOKIO_WORKER_THREADS`.
/// With the environment empty, none of them can pick up a setting.
fn clear_environment() -> Vec<String> {
    let mut names: Vec<OsString> = env::vars_os()
        .map(|(name, _)| name)
        // `remove_var` rejects these, such as the hidden `=C:` entries on Windows.
        .filter(|name| !name.is_empty() && !name.as_encoded_bytes().contains(&b'='))
        .collect();
    names.sort();
    for name in &names {
        // SAFETY: this runs first in `main`, before any other thread exists, so nothing
        // can read or write the environment at the same time.
        unsafe { env::remove_var(name) };
    }
    names
        .into_iter()
        .map(|name| name.to_string_lossy().into_owned())
        .collect()
}

#[derive(Debug, PartialEq)]
enum Command {
    Run { config: PathBuf },
    Help,
    Version,
}

/// Arguments only choose the config file; they carry no settings (FR-CFG-01).
fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Command, String> {
    let mut args = args.into_iter();
    let mut config = None;
    while let Some(arg) = args.next() {
        let path = match arg.to_str() {
            Some("-h" | "--help") => return Ok(Command::Help),
            Some("-V" | "--version") => return Ok(Command::Version),
            Some("-c" | "--config") => args.next().ok_or("--config needs a path")?,
            Some(other) if other.starts_with("--config=") => other["--config=".len()..].into(),
            // Only the part before `=`, in case someone tries to pass a secret this way.
            _ => {
                let arg = arg.to_string_lossy();
                let name = arg.split('=').next().unwrap_or_default();
                return Err(format!("unknown argument {name}"));
            }
        };
        if path.is_empty() {
            return Err("--config needs a path".to_owned());
        }
        if config.replace(PathBuf::from(path)).is_some() {
            return Err("--config can be given only once".to_owned());
        }
    }
    Ok(Command::Run {
        config: config.unwrap_or_else(|| DEFAULT_CONFIG_PATH.into()),
    })
}

fn init_logging(level: LogLevel) {
    let level = match level {
        LogLevel::Debug => tracing::Level::DEBUG,
        LogLevel::Info => tracing::Level::INFO,
        LogLevel::Warn => tracing::Level::WARN,
        LogLevel::Error => tracing::Level::ERROR,
    };
    tracing_subscriber::fmt()
        .with_max_level(level)
        .with_ansi(std::io::stdout().is_terminal())
        .init();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Command, String> {
        parse_args(args.iter().map(OsString::from))
    }

    fn run(config: &str) -> Result<Command, String> {
        Ok(Command::Run {
            config: config.into(),
        })
    }

    #[test]
    fn config_path_defaults_to_the_working_directory() {
        assert_eq!(parse(&[]), run("BuhTig.toml"));
    }

    #[test]
    fn config_path_can_be_overridden() {
        assert_eq!(parse(&["--config", "/etc/a.toml"]), run("/etc/a.toml"));
        assert_eq!(parse(&["-c", "a.toml"]), run("a.toml"));
        assert_eq!(parse(&["--config=a.toml"]), run("a.toml"));
    }

    #[test]
    fn help_and_version() {
        assert_eq!(parse(&["--help"]), Ok(Command::Help));
        assert_eq!(parse(&["-h"]), Ok(Command::Help));
        assert_eq!(parse(&["--version"]), Ok(Command::Version));
        assert_eq!(parse(&["-V"]), Ok(Command::Version));
    }

    #[test]
    fn arguments_carry_no_settings() {
        assert_eq!(
            parse(&["--listen", "0.0.0.0:1"]),
            Err("unknown argument --listen".into())
        );
        assert_eq!(
            parse(&["--client-secret=hunter2"]),
            Err("unknown argument --client-secret".into())
        );
        assert_eq!(
            parse(&["BuhTig.toml"]),
            Err("unknown argument BuhTig.toml".into())
        );
    }

    #[test]
    fn config_needs_exactly_one_path() {
        assert_eq!(parse(&["--config"]), Err("--config needs a path".into()));
        assert_eq!(parse(&["--config="]), Err("--config needs a path".into()));
        assert_eq!(
            parse(&["-c", "a.toml", "-c", "b.toml"]),
            Err("--config can be given only once".into())
        );
    }
}
