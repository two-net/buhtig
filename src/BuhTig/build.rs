//! Release builds embed the web UI (see `src/ui.rs`). Its bundles are named after their
//! contents, so Cargo cannot know which files to watch; this has it rebuild BuhTig
//! whenever anything in the UI's build output changes.

use std::env;
use std::path::Path;

const UI: &str = "../BuhTig.Angular/dist/BuhTig/browser";

fn main() {
    println!("cargo::rerun-if-changed=build.rs");
    // Debug builds read the UI from disk as they serve it, so it never makes them stale.
    if env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }
    // Cargo checks every file in the folder, and reruns this each time while it is missing.
    println!("cargo::rerun-if-changed={UI}");
    if !Path::new(UI).join("index.html").is_file() {
        println!(
            "cargo::warning=the web UI is not built, so this BuhTig will not include it; \
             run `npm ci && npm run build` in src/BuhTig.Angular first"
        );
    }
}
