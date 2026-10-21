//! What BuhTig logs, collected for tests that check it.

use std::io;
use std::sync::{Arc, Mutex};

/// Collects what is logged on this thread while the guard lives.
pub fn capture_log() -> (Arc<Mutex<Vec<u8>>>, tracing::subscriber::DefaultGuard) {
    struct Writer(Arc<Mutex<Vec<u8>>>);
    impl io::Write for Writer {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    let log = Arc::new(Mutex::new(Vec::new()));
    let writer = log.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_ansi(false)
        .with_writer(move || Writer(writer.clone()))
        .finish();
    (log, tracing::subscriber::set_default(subscriber))
}
