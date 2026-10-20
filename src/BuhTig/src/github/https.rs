//! The [`Transport`] BuhTig uses: HTTPS to GitHub (IF-05), directly or through
//! `github.proxy_url`, and never through a proxy that the environment or the system
//! names (FR-CFG-02).
//!
//! TLS is rustls with ring, as for the database, and trusts only the Mozilla root
//! certificates built into BuhTig, so it needs no CA files on the host. A proxy that
//! inspects TLS with a CA of its own therefore does not work.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::http::{Request, Response};
use reqwest::Proxy;
use reqwest::redirect::Policy;
use url::Url;

use super::{Error, Sending, Transport};
use crate::config::Secret;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a request may take, answer included. Statistics GitHub computes on demand
/// can take a while.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The largest answer BuhTig reads, after decompression. A page of 100 repositories is
/// well under 1 MiB.
const MAX_BODY: usize = 32 * 1024 * 1024;

pub struct Https(reqwest::Client);

impl Https {
    pub fn new(proxy: Option<&Secret<Url>>) -> Result<Https, String> {
        let builder = reqwest::Client::builder()
            .https_only(true)
            // The client follows redirects itself, only within api.github.com.
            .redirect(Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TIMEOUT)
            .tls_backend_preconfigured(tls()?);
        // Either way, reqwest no longer looks for a proxy in the environment or the
        // system settings. `main` has removed the environment as well.
        let builder = match proxy {
            Some(url) => builder.proxy(
                // The proxy's credentials, if the URL has them, go in `Proxy-Authorization`.
                Proxy::all(url.expose().as_str())
                    .map_err(|_| "github.proxy_url is not a proxy BuhTig can use".to_owned())?,
            ),
            None => builder.no_proxy(),
        };
        builder
            .build()
            .map(Https)
            .map_err(|error| format!("cannot set up the GitHub client: {}", describe(error)))
    }
}

/// TLS for HTTP/1.1, the only HTTP this build speaks.
fn tls() -> Result<rustls::ClientConfig, String> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|error| format!("cannot set up TLS for GitHub: {error}"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

impl Transport for Https {
    fn send(&self, request: Request<()>) -> Sending<'_> {
        Box::pin(async move {
            let request = reqwest::Request::try_from(request.map(|()| Bytes::new()))
                .map_err(describe_error)?;
            let response = self.0.execute(request).await.map_err(describe_error)?;
            let mut answer = Response::new(Bytes::new());
            *answer.status_mut() = response.status();
            *answer.headers_mut() = response.headers().clone();
            *answer.body_mut() = read_body(response, MAX_BODY).await?;
            Ok(answer)
        })
    }
}

/// Reads a body of at most `limit` bytes.
async fn read_body(mut response: reqwest::Response, limit: usize) -> Result<Bytes, Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(describe_error)? {
        if body.len() + chunk.len() > limit {
            return Err(Error::Invalid(format!(
                "the answer is longer than {limit} bytes"
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body.into())
}

/// A request BuhTig could not make is [`Error::Invalid`], and one that got no answer is
/// [`Error::Unreachable`].
fn describe_error(error: reqwest::Error) -> Error {
    if error.is_builder() {
        Error::Invalid(describe(error))
    } else {
        Error::Unreachable(describe(error))
    }
}

/// An error and its causes, without the URL. Neither names the proxy or its credentials.
fn describe(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut text = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::super::{Client, Credential, Path, Reply};
    use super::*;
    use crate::config::GithubConfig;

    fn config(proxy_url: Option<&str>) -> GithubConfig {
        GithubConfig {
            client_id: "Iv1.not-a-client-id".to_owned(),
            client_secret: Secret::new("not-a-client-secret".to_owned()),
            proxy_url: proxy_url.map(|url| Secret::new(Url::parse(url).unwrap())),
        }
    }

    fn get(url: &str) -> Request<()> {
        Request::builder().uri(url).body(()).unwrap()
    }

    /// reqwest only finds out at this point whether it takes the TLS configuration, which
    /// it does only from the rustls version it uses itself.
    #[test]
    fn the_client_builds() {
        Client::new(&config(None)).unwrap();
        Client::new(&config(Some("http://proxy.example.com:3128"))).unwrap();
        Client::new(&config(Some("https://user:pw@proxy.example.com"))).unwrap();
    }

    #[tokio::test]
    async fn plain_http_is_refused_before_connecting() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let https = Https::new(None).unwrap();

        let error = https.send(get(&url)).await.unwrap_err();
        assert!(matches!(error, Error::Invalid(_)), "{error:?}");
        let connection = tokio::time::timeout(Duration::from_millis(200), listener.accept()).await;
        assert!(connection.is_err(), "connected anyway");
    }

    #[tokio::test]
    async fn requests_tunnel_through_the_configured_proxy() {
        let proxy = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = proxy.local_addr().unwrap();
        // A proxy that turns the tunnel down, and reports what it was asked.
        let asked = tokio::spawn(async move {
            let (mut stream, _) = proxy.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            while !request.ends_with(b"\r\n\r\n") {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0, "the request ended early");
                request.extend_from_slice(&buffer[..read]);
            }
            stream
                .write_all(b"HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n")
                .await
                .unwrap();
            String::from_utf8(request).unwrap()
        });
        let proxy_url =
            Secret::new(Url::parse(&format!("http://user:proxy-password@{address}")).unwrap());
        let https = Https::new(Some(&proxy_url)).unwrap();

        let error = https
            .send(get("https://api.github.com/rate_limit"))
            .await
            .unwrap_err();
        let asked = asked.await.unwrap();
        assert!(
            asked.starts_with("CONNECT api.github.com:443 HTTP/1.1\r\n"),
            "{asked}"
        );
        // `user:proxy-password` in base64.
        assert!(
            asked
                .to_ascii_lowercase()
                .contains("\r\nproxy-authorization: basic dxnlcjpwcm94es1wyxnzd29yza==\r\n"),
            "{asked}"
        );
        assert!(matches!(error, Error::Unreachable(_)), "{error:?}");
        assert!(!error.to_string().contains("proxy-password"), "{error}");
    }

    #[tokio::test]
    async fn bodies_longer_than_the_limit_are_refused() {
        let response = |length| reqwest::Response::from(Response::new(vec![b'x'; length]));
        assert_eq!(read_body(response(10), 10).await.unwrap().len(), 10);
        assert_eq!(
            read_body(response(11), 10).await,
            Err(Error::Invalid(
                "the answer is longer than 10 bytes".to_owned()
            ))
        );
    }

    /// The only test that reaches GitHub: it shows that TLS and gzip work against it. The
    /// app credentials are made up, and GitHub ignores app credentials it does not know,
    /// so the request counts as anonymous. Run it with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore = "calls the real GitHub"]
    async fn reads_a_public_repository_from_github() {
        let client = Client::new(&config(None)).unwrap();
        let rust = Path::new(["repos", "rust-lang", "rust"]).unwrap();
        match client.get(&Credential::Visitor, &rust, None).await {
            Ok(Reply::Fresh { data, .. }) => assert_eq!(data["full_name"], "rust-lang/rust"),
            other => panic!("{other:?}"),
        }
        assert!(client.visitor_rate_limit().is_some());
    }
}
