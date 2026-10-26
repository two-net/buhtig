//! Reading and setting cookies. BuhTig sets only two, both strictly necessary
//! (NFR-PRIV-01): the session's ([`crate::session`]), and a sign-in's short-lived state
//! ([`crate::auth`]).

use std::time::Duration;

use axum::http::header::COOKIE;
use axum::http::{HeaderMap, HeaderValue};

/// The value of the cookie `name` that a request carries, if any.
pub fn get<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| {
            let (key, value) = pair.trim().split_once('=')?;
            (key == name).then_some(value)
        })
}

/// A `Set-Cookie` value for the cookie `name`, which the browser keeps for `max_age` and
/// sends only with requests under `path` (NFR-SEC-01). Scripts cannot read it
/// (`HttpOnly`). Other sites' requests do not carry it, except when they navigate to
/// BuhTig, as GitHub does after sign-in (`SameSite=Lax`). When `secure`, it goes over
/// HTTPS alone.
///
/// `value` must be made of characters that a cookie may hold as they are, such as
/// base64url's.
pub fn set(name: &str, value: &str, path: &str, max_age: Duration, secure: bool) -> HeaderValue {
    let mut cookie = format!(
        "{name}={value}; Path={path}; Max-Age={}; HttpOnly; SameSite=Lax",
        max_age.as_secs()
    );
    if secure {
        cookie.push_str("; Secure");
    }
    let mut cookie = HeaderValue::try_from(cookie).expect("a cookie of base64url is a header");
    cookie.set_sensitive(true);
    cookie
}

/// A `Set-Cookie` value that removes the cookie `name` set for `path`.
pub fn remove(name: &str, path: &str, secure: bool) -> HeaderValue {
    set(name, "", path, Duration::ZERO, secure)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(cookies: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for cookie in cookies {
            headers.append(COOKIE, HeaderValue::from_str(cookie).unwrap());
        }
        headers
    }

    #[test]
    fn cookies_are_found_by_their_exact_name() {
        let headers = headers(&[
            "theme=dark; buhtig_session=abc",
            "other=x;buhtig_sign_in=d.e",
        ]);
        assert_eq!(get(&headers, "buhtig_session"), Some("abc"));
        assert_eq!(get(&headers, "buhtig_sign_in"), Some("d.e"));
        assert_eq!(get(&headers, "buhtig"), None);
        assert_eq!(get(&headers, "session"), None);
        assert_eq!(get(&HeaderMap::new(), "buhtig_session"), None);
    }

    #[test]
    fn cookies_are_for_buhtig_alone() {
        assert_eq!(
            set("a", "b", "/", Duration::from_secs(60), true),
            "a=b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure"
        );
        assert_eq!(
            set("a", "b", "/-/auth/", Duration::from_secs(600), false),
            "a=b; Path=/-/auth/; Max-Age=600; HttpOnly; SameSite=Lax"
        );
        assert_eq!(
            remove("a", "/", true),
            "a=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"
        );
        assert!(set("a", "b", "/", Duration::ZERO, true).is_sensitive());
    }
}
