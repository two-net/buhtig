//! The cryptography BuhTig does itself (SRS §6.4): random IDs for sessions and sign-ins
//! (NFR-SEC-01, FR-AUTH-03), the hashes that the database keeps of session IDs (DR-02),
//! and the encryption of the GitHub credentials it stores, with `security.encryption_key`
//! (DR-03). All of it is ring's, which TLS already uses.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::digest::{SHA256, digest};
use ring::hkdf::{HKDF_SHA256, Salt};
use ring::rand::{SecureRandom, SystemRandom};

/// What the key that [`Sealer`] derives is for, so that a key derived from the same
/// secret for anything else would differ.
const SEALER_INFO: &[u8] = b"BuhTig credentials 1";

/// 256 random bits from the operating system, in base64url: 43 characters that can go in
/// a cookie or a URL as they are.
pub fn random_id() -> String {
    let mut bytes = [0; 32];
    fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn fill(bytes: &mut [u8]) {
    SystemRandom::new()
        .fill(bytes)
        .expect("the operating system gives random bytes");
}

pub fn sha256(data: &[u8]) -> Vec<u8> {
    digest(&SHA256, data).as_ref().to_vec()
}

/// Encrypts and authenticates values with a key derived from `security.encryption_key`,
/// so that the database holds no credential that it alone could reveal (DR-03).
///
/// Each value is sealed for a context, such as which user's credential it is, and opens
/// only for that context: a value copied to another row of the database does not open.
pub struct Sealer(LessSafeKey);

impl Sealer {
    /// The config file checks that the secret has at least 256 bits.
    pub fn new(secret: &[u8]) -> Sealer {
        let prk = Salt::new(HKDF_SHA256, &[]).extract(secret);
        let key = prk
            .expand(&[SEALER_INFO], &AES_256_GCM)
            .expect("AES-256-GCM's key is short enough for HKDF-SHA256");
        Sealer(LessSafeKey::new(UnboundKey::from(key)))
    }

    /// `plaintext`, encrypted for `context`: a random nonce, then the ciphertext and its
    /// tag. With a random 96-bit nonce, a key may seal billions of values.
    pub fn seal(&self, plaintext: &[u8], context: &[u8]) -> Vec<u8> {
        let mut nonce = [0; NONCE_LEN];
        fill(&mut nonce);
        let mut sealed = plaintext.to_vec();
        self.0
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(context),
                &mut sealed,
            )
            .expect("a credential is far shorter than AES-GCM's limit");
        [nonce.as_slice(), &sealed].concat()
    }

    /// What [`Sealer::seal`] sealed for `context`, or `None` if it was sealed for another
    /// context, with another key, or not at all.
    pub fn open(&self, sealed: &[u8], context: &[u8]) -> Option<Vec<u8>> {
        let (nonce, ciphertext) = sealed.split_at_checked(NONCE_LEN)?;
        let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
        let mut ciphertext = ciphertext.to_vec();
        let plaintext = self
            .0
            .open_in_place(nonce, Aad::from(context), &mut ciphertext)
            .ok()?;
        Some(plaintext.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8] = b"a secret of at least thirty-two bytes";

    #[test]
    fn random_ids_carry_256_bits() {
        let id = random_id();
        assert_eq!(URL_SAFE_NO_PAD.decode(&id).unwrap().len(), 32);
        assert_ne!(id, random_id());
    }

    #[test]
    fn sealed_values_open_only_for_their_context_and_key() {
        let sealer = Sealer::new(KEY);
        let sealed = sealer.seal(b"gho_token", b"credential 1");
        assert!(!sealed.windows(9).any(|window| window == b"gho_token"));
        assert_eq!(
            sealer.open(&sealed, b"credential 1").as_deref(),
            Some(b"gho_token".as_slice())
        );

        assert_eq!(sealer.open(&sealed, b"credential 2"), None);
        assert_eq!(
            Sealer::new(b"another secret of thirty-two bytes").open(&sealed, b"credential 1"),
            None
        );
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(sealer.open(&tampered, b"credential 1"), None);
        assert_eq!(sealer.open(&sealed[..NONCE_LEN], b"credential 1"), None);
        assert_eq!(sealer.open(b"short", b"credential 1"), None);
    }

    #[test]
    fn each_seal_takes_a_new_nonce() {
        let sealer = Sealer::new(KEY);
        assert_ne!(sealer.seal(b"same", b"c"), sealer.seal(b"same", b"c"));
    }
}
