//! The single configuration file (SRS §4.11, Table 4-3).
//!
//! Every setting, including sensitive ones, comes from one TOML file (CON-07). Values
//! are checked by hand rather than with serde so that every problem is reported at once
//! under its full `section.key` name, and no message ever echoes a value (FR-CFG-03).

#![allow(
    dead_code,
    reason = "settings are read by features still to come (#2, #5, #22, …)"
)]

use std::collections::BTreeSet;
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use toml::{Table, Value};
use url::Url;

const MINUTE: u64 = 60;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;

#[derive(Debug, PartialEq)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub github: GithubConfig,
    pub security: SecurityConfig,
    pub access: AccessConfig,
    pub auth: AuthConfig,
    pub cache: CacheConfig,
    pub limits: LimitsConfig,
    pub ui: UiConfig,
    pub log: LogConfig,
}

#[derive(Debug, PartialEq)]
pub struct ServerConfig {
    pub public_url: Url,
    pub listen: SocketAddr,
}

#[derive(Debug, PartialEq)]
pub struct DatabaseConfig {
    pub url: Secret<Url>,
    pub max_connections: u32,
}

#[derive(Debug, PartialEq)]
pub struct GithubConfig {
    pub client_id: String,
    pub client_secret: Secret<String>,
    /// Redacted as well, because a proxy URL may carry the proxy's credentials.
    pub proxy_url: Option<Secret<Url>>,
}

#[derive(Debug, PartialEq)]
pub struct SecurityConfig {
    /// At least 32 bytes, decoded from base64.
    pub encryption_key: Secret<Vec<u8>>,
}

#[derive(Debug, PartialEq)]
pub struct AccessConfig {
    pub mode: AccessMode,
    /// Lowercase GitHub logins; empty means anyone may sign in (FR-AUTH-08).
    pub allowed_users: BTreeSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessMode {
    Public,
    Private,
}

impl fmt::Display for AccessMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            AccessMode::Public => "public",
            AccessMode::Private => "private",
        })
    }
}

#[derive(Debug, PartialEq)]
pub struct AuthConfig {
    pub session_idle_timeout: Duration,
    pub session_max_age: Duration,
}

#[derive(Debug, PartialEq)]
pub struct CacheConfig {
    pub ttl: Duration,
    pub retention: Duration,
}

#[derive(Debug, PartialEq)]
pub struct LimitsConfig {
    pub org_repositories: u32,
    pub visitor_fetches_per_hour: u32,
}

#[derive(Debug, PartialEq)]
pub struct UiConfig {
    pub animations: bool,
}

#[derive(Debug, PartialEq)]
pub struct LogConfig {
    pub level: LogLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// A sensitive value. It prints as `[redacted]`, so it cannot leak into logs or pages
/// (FR-CFG-04).
#[derive(Clone, PartialEq, Eq)]
pub struct Secret<T>(T);

impl<T> Secret<T> {
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> fmt::Debug for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// Why the config file cannot be used. The message never contains a value from the file.
#[derive(Debug)]
pub enum LoadError {
    Read(PathBuf, io::Error),
    Invalid(PathBuf, Vec<Issue>),
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Read(path, error) => {
                write!(f, "cannot read config file {}: {error}", path.display())
            }
            LoadError::Invalid(path, issues) => {
                write!(f, "invalid config file {}:", path.display())?;
                for issue in issues {
                    write!(f, "\n  {issue}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for LoadError {}

/// One problem in the file: the key (or line and column) it is at, and what is wrong.
#[derive(Debug, PartialEq)]
pub struct Issue {
    pub at: String,
    pub problem: String,
}

impl Issue {
    fn new(at: impl Into<String>, problem: impl Into<String>) -> Self {
        Issue {
            at: at.into(),
            problem: problem.into(),
        }
    }
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.at, self.problem)
    }
}

impl Config {
    /// Reads and validates the config file. This is the only place settings come from.
    pub fn load(path: &Path) -> Result<Config, LoadError> {
        let text =
            std::fs::read_to_string(path).map_err(|error| LoadError::Read(path.into(), error))?;
        Config::parse(&text).map_err(|issues| LoadError::Invalid(path.into(), issues))
    }

    /// Validates the text of a config file against Table 4-3.
    pub fn parse(text: &str) -> Result<Config, Vec<Issue>> {
        let mut root: Table = text
            .parse()
            .map_err(|error| vec![syntax_issue(text, &error)])?;

        let mut server = Section::take(&mut root, "server");
        let public_url = server.required("public_url", public_url);
        let listen = server.optional("listen", SocketAddr::from(([0, 0, 0, 0], 8080)), listen);

        let mut database = Section::take(&mut root, "database");
        let database_url = database.required("url", database_url);
        let max_connections = database.optional("max_connections", 10, whole_number(1));

        let mut github = Section::take(&mut root, "github");
        let client_id = github.required("client_id", non_empty);
        let client_secret = github.required("client_secret", |value| non_empty(value).map(Secret));
        let proxy_url = github.optional("proxy_url", None, |value| proxy_url(value).map(Some));

        let mut security = Section::take(&mut root, "security");
        let encryption_key = security.required("encryption_key", encryption_key);

        let mut access = Section::take(&mut root, "access");
        let mode = access.optional("mode", AccessMode::Public, access_mode);
        let allowed_users = access.optional("allowed_users", BTreeSet::new(), github_logins);

        let mut auth = Section::take(&mut root, "auth");
        let session_idle_timeout = auth.optional(
            "session_idle_timeout",
            Duration::from_secs(7 * DAY),
            duration,
        );
        let session_max_age =
            auth.optional("session_max_age", Duration::from_secs(30 * DAY), duration);

        let mut cache = Section::take(&mut root, "cache");
        let ttl = cache.optional("ttl", Duration::from_secs(15 * MINUTE), duration);
        let retention = cache.optional("retention", Duration::from_secs(30 * DAY), duration);

        let mut limits = Section::take(&mut root, "limits");
        let org_repositories = limits.optional("org_repositories", 1000, whole_number(1));
        let visitor_fetches_per_hour =
            limits.optional("visitor_fetches_per_hour", 30, whole_number(0));

        let mut ui = Section::take(&mut root, "ui");
        let animations = ui.optional("animations", true, boolean);

        let mut log = Section::take(&mut root, "log");
        let level = log.optional("level", LogLevel::Info, log_level);

        let mut issues: Vec<Issue> = [
            server, database, github, security, access, auth, cache, limits, ui, log,
        ]
        .into_iter()
        .flat_map(Section::finish)
        .collect();
        issues.extend(root.keys().map(|key| Issue::new(key, "unknown key")));

        // A missing required key has already been reported, so `issues` is never empty here
        // when one of them is `None`.
        match (
            public_url,
            database_url,
            client_id,
            client_secret,
            encryption_key,
        ) {
            (
                Some(public_url),
                Some(database_url),
                Some(client_id),
                Some(client_secret),
                Some(encryption_key),
            ) if issues.is_empty() => Ok(Config {
                server: ServerConfig { public_url, listen },
                database: DatabaseConfig {
                    url: database_url,
                    max_connections,
                },
                github: GithubConfig {
                    client_id,
                    client_secret,
                    proxy_url,
                },
                security: SecurityConfig { encryption_key },
                access: AccessConfig {
                    mode,
                    allowed_users,
                },
                auth: AuthConfig {
                    session_idle_timeout,
                    session_max_age,
                },
                cache: CacheConfig { ttl, retention },
                limits: LimitsConfig {
                    org_repositories,
                    visitor_fetches_per_hour,
                },
                ui: UiConfig { animations },
                log: LogConfig { level },
            }),
            _ => Err(issues),
        }
    }
}

/// Whether accounts other than the file's owner may read the file (FR-CFG-05).
#[cfg(unix)]
pub fn readable_by_others(path: &Path) -> io::Result<bool> {
    use std::os::unix::fs::PermissionsExt;

    Ok(std::fs::metadata(path)?.permissions().mode() & 0o044 != 0)
}

#[cfg(not(unix))]
pub fn readable_by_others(_path: &Path) -> io::Result<bool> {
    Ok(false)
}

/// Locates a TOML syntax error by line and column. `toml`'s own `Display` would quote the
/// offending line, which may hold a secret.
fn syntax_issue(text: &str, error: &toml::de::Error) -> Issue {
    let at = match error.span() {
        Some(span) => {
            let before = text.get(..span.start).unwrap_or(text);
            let line = before.matches('\n').count() + 1;
            let column = before.rsplit('\n').next().unwrap_or("").chars().count() + 1;
            format!("line {line}, column {column}")
        }
        None => "file".to_owned(),
    };
    Issue::new(at, format!("invalid TOML: {}", error.message()))
}

/// One `[section]` of the file. Keys are removed as they are read, so whatever is left
/// at the end is unknown.
struct Section {
    name: &'static str,
    table: Table,
    /// False when the section is not a table; its keys are then not reported as missing.
    is_table: bool,
    issues: Vec<Issue>,
}

impl Section {
    fn take(root: &mut Table, name: &'static str) -> Self {
        let mut section = Section {
            name,
            table: Table::new(),
            is_table: true,
            issues: Vec::new(),
        };
        match root.remove(name) {
            None => {}
            Some(Value::Table(table)) => section.table = table,
            Some(_) => {
                section.is_table = false;
                section.issues.push(Issue::new(name, "must be a table"));
            }
        }
        section
    }

    fn required<T>(
        &mut self,
        key: &str,
        parse: impl FnOnce(Value) -> Result<T, String>,
    ) -> Option<T> {
        match self.table.remove(key) {
            Some(value) => self.check(key, parse(value)),
            None => {
                if self.is_table {
                    self.issue(key, "required key is missing".to_owned());
                }
                None
            }
        }
    }

    fn optional<T>(
        &mut self,
        key: &str,
        default: T,
        parse: impl FnOnce(Value) -> Result<T, String>,
    ) -> T {
        match self.table.remove(key) {
            Some(value) => self.check(key, parse(value)).unwrap_or(default),
            None => default,
        }
    }

    fn check<T>(&mut self, key: &str, result: Result<T, String>) -> Option<T> {
        result.map_err(|problem| self.issue(key, problem)).ok()
    }

    fn issue(&mut self, key: &str, problem: String) {
        self.issues
            .push(Issue::new(format!("{}.{key}", self.name), problem));
    }

    fn finish(mut self) -> Vec<Issue> {
        let unknown: Vec<String> = self.table.keys().cloned().collect();
        for key in unknown {
            self.issue(&key, "unknown key".to_owned());
        }
        self.issues
    }
}

// Value parsers. Their messages never include the value, so they are safe for sensitive
// keys too.

fn string(value: Value) -> Result<String, String> {
    match value {
        // FR-CFG-02: values are taken literally, never filled in from the environment.
        Value::String(text) if text.contains("${") => {
            Err("`${...}` substitution is not supported; write the value itself".to_owned())
        }
        Value::String(text) => Ok(text),
        _ => Err("must be a string".to_owned()),
    }
}

fn non_empty(value: Value) -> Result<String, String> {
    let text = string(value)?;
    if text.trim().is_empty() {
        return Err("must not be empty".to_owned());
    }
    Ok(text)
}

fn boolean(value: Value) -> Result<bool, String> {
    match value {
        Value::Boolean(flag) => Ok(flag),
        _ => Err("must be true or false".to_owned()),
    }
}

fn whole_number(min: u32) -> impl FnOnce(Value) -> Result<u32, String> {
    move |value| match value {
        Value::Integer(number) => u32::try_from(number)
            .ok()
            .filter(|&number| number >= min)
            .ok_or_else(|| format!("must be a whole number from {min} to {}", u32::MAX)),
        _ => Err("must be a whole number".to_owned()),
    }
}

/// `<n>s`, `<n>m`, `<n>h` or `<n>d`, with `n` greater than zero.
fn duration(value: Value) -> Result<Duration, String> {
    const PROBLEM: &str = "must be a duration such as 30s, 15m, 12h or 7d";
    let text = string(value)?;
    let unit = match text.chars().last() {
        Some('s') => 1,
        Some('m') => MINUTE,
        Some('h') => HOUR,
        Some('d') => DAY,
        _ => return Err(PROBLEM.to_owned()),
    };
    let digits = &text[..text.len() - 1];
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PROBLEM.to_owned());
    }
    match digits
        .parse::<u64>()
        .ok()
        .and_then(|count| count.checked_mul(unit))
    {
        Some(0) => Err("must be longer than zero".to_owned()),
        Some(seconds) => Ok(Duration::from_secs(seconds)),
        None => Err("is too long".to_owned()),
    }
}

/// IF-04: browsers reach BuhTig over HTTPS, so plain HTTP is only for `localhost`.
fn public_url(value: Value) -> Result<Url, String> {
    const PROBLEM: &str = "must be an https:// URL such as https://buhtig.example.com";
    let url = Url::parse(&string(value)?).map_err(|_| PROBLEM.to_owned())?;
    match (url.scheme(), url.host_str()) {
        ("https", Some(_)) | ("http", Some("localhost")) => {}
        ("http", Some(_)) => {
            return Err("must use https:// unless the host is localhost".to_owned());
        }
        _ => return Err(PROBLEM.to_owned()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("must not contain a user name or password".to_owned());
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("must not contain a path, query or fragment".to_owned());
    }
    Ok(url)
}

fn listen(value: Value) -> Result<SocketAddr, String> {
    string(value)?
        .parse()
        .map_err(|_| "must be an IP address and port such as 0.0.0.0:8080".to_owned())
}

fn database_url(value: Value) -> Result<Secret<Url>, String> {
    Url::parse(&string(value)?)
        .ok()
        .filter(|url| matches!(url.scheme(), "postgres" | "postgresql"))
        .map(Secret)
        .ok_or_else(|| {
            "must be a PostgreSQL URL such as postgres://user:password@host/database".to_owned()
        })
}

fn proxy_url(value: Value) -> Result<Secret<Url>, String> {
    Url::parse(&string(value)?)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.has_host())
        .map(Secret)
        .ok_or_else(|| "must be an http:// or https:// URL".to_owned())
}

fn encryption_key(value: Value) -> Result<Secret<Vec<u8>>, String> {
    BASE64
        .decode(string(value)?)
        .ok()
        .filter(|key| key.len() >= 32)
        .map(Secret)
        .ok_or_else(|| {
            "must be at least 32 random bytes (256 bits) in base64; \
             generate one with `openssl rand -base64 32`"
                .to_owned()
        })
}

fn access_mode(value: Value) -> Result<AccessMode, String> {
    match string(value)?.as_str() {
        "public" => Ok(AccessMode::Public),
        "private" => Ok(AccessMode::Private),
        _ => Err(r#"must be "public" or "private""#.to_owned()),
    }
}

/// GitHub logins are not sensitive, so a bad one is quoted to help find it.
fn github_logins(value: Value) -> Result<BTreeSet<String>, String> {
    const PROBLEM: &str = "must be a list of GitHub logins";
    let Value::Array(entries) = value else {
        return Err(PROBLEM.to_owned());
    };
    let mut logins = BTreeSet::new();
    for entry in entries {
        let Value::String(login) = entry else {
            return Err(PROBLEM.to_owned());
        };
        // Letters, digits and hyphens, plus `_` for enterprise managed users.
        let valid = !login.is_empty()
            && login
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !valid {
            return Err(format!("{login:?} is not a GitHub login"));
        }
        logins.insert(login.to_ascii_lowercase());
    }
    Ok(logins)
}

fn log_level(value: Value) -> Result<LogLevel, String> {
    match string(value)?.as_str() {
        "debug" => Ok(LogLevel::Debug),
        "info" => Ok(LogLevel::Info),
        "warn" => Ok(LogLevel::Warn),
        "error" => Ok(LogLevel::Error),
        _ => Err(r#"must be "debug", "info", "warn" or "error""#.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc=";

    const MINIMAL: &str = r#"
        [server]
        public_url = "https://buhtig.example.com"

        [database]
        url = "postgres://buhtig:db-password@db.example.com/buhtig"

        [github]
        client_id = "Iv1.client-id"
        client_secret = "github-client-secret"

        [security]
        encryption_key = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc="
    "#;

    const REQUIRED: [&str; 5] = [
        "server.public_url",
        "database.url",
        "github.client_id",
        "github.client_secret",
        "security.encryption_key",
    ];

    const SECTIONS: [&str; 10] = [
        "server", "database", "github", "security", "access", "auth", "cache", "limits", "ui",
        "log",
    ];

    /// Every key in Table 4-3.
    const KEYS: [&str; 18] = [
        "server.public_url",
        "server.listen",
        "database.url",
        "database.max_connections",
        "github.client_id",
        "github.client_secret",
        "github.proxy_url",
        "security.encryption_key",
        "access.mode",
        "access.allowed_users",
        "auth.session_idle_timeout",
        "auth.session_max_age",
        "cache.ttl",
        "cache.retention",
        "limits.org_repositories",
        "limits.visitor_fetches_per_hour",
        "ui.animations",
        "log.level",
    ];

    fn minimal() -> Table {
        MINIMAL.parse().unwrap()
    }

    fn set(mut table: Table, key: &str, value: impl Into<Value>) -> Table {
        let (section, key) = key.split_once('.').unwrap();
        table
            .entry(section)
            .or_insert_with(|| Value::Table(Table::new()))
            .as_table_mut()
            .unwrap()
            .insert(key.to_owned(), value.into());
        table
    }

    fn remove(mut table: Table, key: &str) -> Table {
        let (section, key) = key.split_once('.').unwrap();
        table
            .get_mut(section)
            .unwrap()
            .as_table_mut()
            .unwrap()
            .remove(key);
        table
    }

    fn parse(table: Table) -> Result<Config, Vec<Issue>> {
        Config::parse(&table.to_string())
    }

    fn issues(table: Table) -> Vec<String> {
        parse(table)
            .unwrap_err()
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    #[test]
    fn minimal_file_gets_the_table_4_3_defaults() {
        let config = parse(minimal()).unwrap();

        assert_eq!(
            config.server.public_url.as_str(),
            "https://buhtig.example.com/"
        );
        assert_eq!(config.server.listen, "0.0.0.0:8080".parse().unwrap());
        assert_eq!(config.database.max_connections, 10);
        assert_eq!(config.github.client_id, "Iv1.client-id");
        assert_eq!(config.github.client_secret.expose(), "github-client-secret");
        assert_eq!(config.github.proxy_url, None);
        assert_eq!(
            config.security.encryption_key.expose(),
            &BASE64.decode(KEY).unwrap()
        );
        assert_eq!(config.access.mode, AccessMode::Public);
        assert!(config.access.allowed_users.is_empty());
        assert_eq!(
            config.auth.session_idle_timeout,
            Duration::from_secs(7 * DAY)
        );
        assert_eq!(config.auth.session_max_age, Duration::from_secs(30 * DAY));
        assert_eq!(config.cache.ttl, Duration::from_secs(15 * MINUTE));
        assert_eq!(config.cache.retention, Duration::from_secs(30 * DAY));
        assert_eq!(config.limits.org_repositories, 1000);
        assert_eq!(config.limits.visitor_fetches_per_hour, 30);
        assert!(config.ui.animations);
        assert_eq!(config.log.level, LogLevel::Info);
    }

    #[test]
    fn each_missing_required_key_is_named() {
        for key in REQUIRED {
            assert_eq!(
                issues(remove(minimal(), key)),
                [format!("{key}: required key is missing")],
            );
        }
    }

    #[test]
    fn empty_file_reports_every_required_key() {
        let at: Vec<String> = Config::parse("")
            .unwrap_err()
            .into_iter()
            .map(|issue| issue.at)
            .collect();
        assert_eq!(at, REQUIRED);
    }

    #[test]
    fn unknown_keys_are_rejected() {
        for section in SECTIONS {
            assert_eq!(
                issues(set(minimal(), &format!("{section}.colour"), "blue")),
                [format!("{section}.colour: unknown key")],
            );
        }

        let mut table = minimal();
        table.insert("colour".to_owned(), "blue".into());
        table.insert("githb".to_owned(), Value::Table(Table::new()));
        assert_eq!(issues(table), ["colour: unknown key", "githb: unknown key"]);

        let nested = set(minimal(), "github.proxy", Value::Table(Table::new()));
        assert_eq!(issues(nested), ["github.proxy: unknown key"]);
    }

    #[test]
    fn a_section_must_be_a_table() {
        let mut table = minimal();
        table.insert("server".to_owned(), "https://buhtig.example.com".into());
        assert_eq!(issues(table), ["server: must be a table"]);
    }

    #[test]
    fn every_problem_is_reported_at_once() {
        let table = set(remove(minimal(), "database.url"), "log.level", "loud");
        let table = set(table, "server.port", 8080);
        assert_eq!(
            issues(table),
            [
                "server.port: unknown key",
                "database.url: required key is missing",
                r#"log.level: must be "debug", "info", "warn" or "error""#,
            ],
        );
    }

    #[test]
    fn invalid_values_are_rejected() {
        #[rustfmt::skip]
        let cases: Vec<(&str, Value, &str)> = vec![
            ("server.public_url", "buhtig.example.com".into(), "must be an https:// URL"),
            ("server.public_url", "http://buhtig.example.com".into(), "must use https://"),
            ("server.public_url", "http://127.0.0.1:8080".into(), "must use https://"),
            ("server.public_url", "ftp://buhtig.example.com".into(), "must be an https:// URL"),
            ("server.public_url", "https://me:pw@buhtig.example.com".into(), "user name"),
            ("server.public_url", "https://example.com/buhtig".into(), "must not contain a path"),
            ("server.public_url", "https://buhtig.example.com/?a=1".into(), "query"),
            ("server.public_url", 443.into(), "must be a string"),
            ("server.listen", "localhost:8080".into(), "must be an IP address and port"),
            ("server.listen", "0.0.0.0".into(), "must be an IP address and port"),
            ("server.listen", 8080.into(), "must be a string"),
            ("database.url", "mysql://u:p@db/buhtig".into(), "must be a PostgreSQL URL"),
            ("database.url", "not a url".into(), "must be a PostgreSQL URL"),
            ("database.max_connections", 0.into(), "must be a whole number from 1"),
            ("database.max_connections", (-1).into(), "must be a whole number from 1"),
            ("database.max_connections", 5_000_000_000_i64.into(), "must be a whole number"),
            ("database.max_connections", "10".into(), "must be a whole number"),
            ("database.max_connections", 10.5.into(), "must be a whole number"),
            ("github.client_id", "".into(), "must not be empty"),
            ("github.client_secret", "  ".into(), "must not be empty"),
            ("github.proxy_url", "socks5://proxy:1080".into(), "must be an http:// or https://"),
            ("github.proxy_url", "proxy:3128".into(), "must be an http:// or https://"),
            ("security.encryption_key", "too-short".into(), "at least 32 random bytes"),
            ("security.encryption_key", "c2hvcnQ=".into(), "at least 32 random bytes"),
            ("access.mode", "secret".into(), r#"must be "public" or "private""#),
            ("access.mode", "Public".into(), r#"must be "public" or "private""#),
            ("access.allowed_users", "alice".into(), "must be a list of GitHub logins"),
            ("access.allowed_users", Value::from(vec![1]), "must be a list of GitHub logins"),
            ("access.allowed_users", Value::from(vec!["@alice"]), r#""@alice" is not"#),
            ("access.allowed_users", Value::from(vec![""]), r#""" is not a GitHub login"#),
            ("auth.session_idle_timeout", "7".into(), "must be a duration"),
            ("auth.session_idle_timeout", "7w".into(), "must be a duration"),
            ("auth.session_idle_timeout", "d".into(), "must be a duration"),
            ("auth.session_idle_timeout", "-7d".into(), "must be a duration"),
            ("auth.session_idle_timeout", "7 d".into(), "must be a duration"),
            ("auth.session_idle_timeout", "7dé".into(), "must be a duration"),
            ("auth.session_max_age", "0d".into(), "must be longer than zero"),
            ("cache.ttl", "99999999999999999999s".into(), "is too long"),
            ("cache.retention", "999999999999999999d".into(), "is too long"),
            ("cache.ttl", 900.into(), "must be a string"),
            ("limits.org_repositories", 0.into(), "must be a whole number from 1"),
            ("limits.visitor_fetches_per_hour", (-1).into(), "must be a whole number from 0"),
            ("ui.animations", "false".into(), "must be true or false"),
            ("log.level", "trace".into(), r#"must be "debug", "info", "warn" or "error""#),
        ];
        for (key, value, problem) in cases {
            let found = issues(set(minimal(), key, value.clone()));
            assert!(
                found.len() == 1
                    && found[0].starts_with(&format!("{key}: "))
                    && found[0].contains(problem),
                "{key} = {value}: expected {problem:?}, got {found:?}",
            );
        }
    }

    #[test]
    fn valid_alternatives_are_accepted() {
        let table = set(minimal(), "server.public_url", "http://localhost:8080/");
        let table = set(table, "server.listen", "[::]:80");
        let table = set(
            table,
            "database.url",
            "postgresql:///buhtig?host=/run/postgresql",
        );
        let table = set(table, "database.max_connections", 1);
        let table = set(
            table,
            "github.proxy_url",
            "http://user:pw@proxy.example.com:3128",
        );
        let table = set(table, "access.mode", "private");
        let table = set(
            table,
            "access.allowed_users",
            vec!["Alice", "alice", "bob_acme", "c-3po"],
        );
        let table = set(table, "auth.session_idle_timeout", "90m");
        let table = set(table, "auth.session_max_age", "12h");
        let table = set(table, "cache.ttl", "30s");
        let table = set(table, "limits.visitor_fetches_per_hour", 0);
        let table = set(table, "ui.animations", false);
        let table = set(table, "log.level", "debug");
        let config = parse(table).unwrap();

        assert_eq!(config.server.public_url.as_str(), "http://localhost:8080/");
        assert_eq!(config.server.listen, "[::]:80".parse().unwrap());
        assert_eq!(config.database.max_connections, 1);
        assert_eq!(
            config.github.proxy_url.unwrap().expose().as_str(),
            "http://user:pw@proxy.example.com:3128/",
        );
        assert_eq!(config.access.mode, AccessMode::Private);
        assert_eq!(
            config.access.allowed_users,
            BTreeSet::from([
                "alice".to_owned(),
                "bob_acme".to_owned(),
                "c-3po".to_owned()
            ]),
        );
        assert_eq!(
            config.auth.session_idle_timeout,
            Duration::from_secs(90 * MINUTE)
        );
        assert_eq!(config.auth.session_max_age, Duration::from_secs(12 * HOUR));
        assert_eq!(config.cache.ttl, Duration::from_secs(30));
        assert_eq!(config.limits.visitor_fetches_per_hour, 0);
        assert!(!config.ui.animations);
        assert_eq!(config.log.level, LogLevel::Debug);
    }

    #[test]
    fn substitution_is_not_supported() {
        for key in [
            "database.url",
            "github.client_id",
            "github.client_secret",
            "cache.ttl",
        ] {
            assert_eq!(
                issues(set(minimal(), key, "${BUHTIG_VALUE}")),
                [format!(
                    "{key}: `${{...}}` substitution is not supported; write the value itself"
                )],
            );
        }
    }

    #[test]
    fn sensitive_values_are_never_echoed() {
        let marker = "hunter2";
        let cases: Vec<(&str, Value)> = vec![
            ("database.url", "mysql://buhtig:hunter2@db/buhtig".into()),
            (
                "database.url",
                "postgres://buhtig:hunter2@db:port/buhtig".into(),
            ),
            ("database.url", "${hunter2}".into()),
            ("database.url", Value::from(vec![marker])),
            ("github.client_secret", 2_000_000_007.into()),
            ("github.client_secret", Value::from(vec![marker])),
            ("security.encryption_key", marker.into()),
            ("security.encryption_key", "aHVudGVyMg==".into()),
            (
                "github.proxy_url",
                "socks5://user:hunter2@proxy:1080".into(),
            ),
        ];
        for (key, value) in cases {
            let text = LoadError::Invalid(
                "BuhTig.toml".into(),
                parse(set(minimal(), key, value.clone())).unwrap_err(),
            )
            .to_string();
            assert!(text.contains(key), "{text}");
            assert!(
                !text.contains(marker) && !text.contains("2000000007"),
                "{text}"
            );
            assert!(!text.contains("aHVudGVyMg"), "{text}");
        }

        let broken = MINIMAL.replace(r#""github-client-secret""#, r#""hunter2"#);
        let issues = Config::parse(&broken).unwrap_err();
        let text = issues[0].to_string();
        assert!(text.starts_with("line 10, column "), "{text}");
        assert!(!text.contains(marker), "{text}");
    }

    #[test]
    fn debug_output_redacts_secrets() {
        let table = set(
            minimal(),
            "github.proxy_url",
            "http://user:proxy-password@proxy:3128",
        );
        let debug = format!("{:?}", parse(table).unwrap());
        for secret in ["db-password", "github-client-secret", KEY, "proxy-password"] {
            assert!(!debug.contains(secret), "{debug}");
        }
        assert!(debug.contains("[redacted]"));
        assert!(debug.contains("Iv1.client-id"));
    }

    #[test]
    fn syntax_errors_name_the_line_and_column() {
        let issues =
            Config::parse("[server]\npublic_url = https://buhtig.example.com\n").unwrap_err();
        assert_eq!(issues.len(), 1);
        assert!(issues[0].at.starts_with("line 2, column "), "{:?}", issues);
        assert!(
            issues[0].problem.starts_with("invalid TOML: "),
            "{:?}",
            issues
        );
    }

    /// FR-CFG-08: the example lists every key, and its commented-out values are the defaults.
    #[test]
    fn example_file_lists_every_key_with_its_default() {
        let example = include_str!("../BuhTig.example.toml").replace(
            r#"encryption_key = "CHANGE-ME""#,
            &format!("encryption_key = {KEY:?}"),
        );
        let uncommented: String = example
            .lines()
            .map(|line| match line.strip_prefix("# ") {
                Some(setting) if is_setting(setting) => setting,
                _ => line,
            })
            .flat_map(|line| [line, "\n"])
            .collect();

        let mut section = "";
        let mut keys = Vec::new();
        for line in uncommented.lines() {
            if let Some(name) = line
                .strip_prefix('[')
                .and_then(|line| line.strip_suffix(']'))
            {
                section = name;
            } else if is_setting(line) {
                keys.push(format!("{section}.{}", line.split_once(" = ").unwrap().0));
            }
        }
        assert_eq!(keys, KEYS);

        let defaults = Config::parse(&example).unwrap();
        let mut every_key = Config::parse(&uncommented).unwrap();
        assert!(
            every_key.github.proxy_url.take().is_some(),
            "proxy_url shows an example"
        );
        assert_eq!(every_key, defaults);
    }

    fn is_setting(line: &str) -> bool {
        line.split_once(" = ").is_some_and(|(key, _)| {
            !key.is_empty()
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        })
    }

    #[test]
    fn example_file_refuses_to_start_until_a_key_is_set() {
        let issues = Config::parse(include_str!("../BuhTig.example.toml")).unwrap_err();
        let at: Vec<&str> = issues.iter().map(|issue| issue.at.as_str()).collect();
        assert_eq!(at, ["security.encryption_key"]);
    }

    #[test]
    fn load_names_an_unreadable_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.toml");
        let error = Config::load(&path).unwrap_err();
        assert!(matches!(error, LoadError::Read(..)));
        assert!(
            error
                .to_string()
                .starts_with(&format!("cannot read config file {}: ", path.display()))
        );
    }

    #[test]
    fn load_names_the_file_and_each_issue() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("BuhTig.toml");
        std::fs::write(&path, remove(minimal(), "database.url").to_string()).unwrap();
        assert_eq!(
            Config::load(&path).unwrap_err().to_string(),
            format!(
                "invalid config file {}:\n  database.url: required key is missing",
                path.display()
            ),
        );
    }

    #[cfg(unix)]
    #[test]
    fn readable_by_others_checks_group_and_world_bits() {
        use std::os::unix::fs::PermissionsExt;

        let file = tempfile::NamedTempFile::new().unwrap();
        for (mode, expected) in [
            (0o600, false),
            (0o400, false),
            (0o640, true),
            (0o604, true),
            (0o644, true),
        ] {
            std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(mode)).unwrap();
            assert_eq!(
                readable_by_others(file.path()).unwrap(),
                expected,
                "mode {mode:o}"
            );
        }
    }
}
