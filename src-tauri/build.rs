#[path = "src/password_hash.rs"]
mod password_hash;

// Used when no LUCKY_DRAW_ADMIN_PASSWORD is set at build time. It's only a
// guard against accidental factory resets; set the variable (a GitHub
// Actions secret for releases) to use a private password instead.
const DEFAULT_ADMIN_PASSWORD: &str = "admin";

fn main() {
    // Only the hash is compiled in, never the password itself.
    println!("cargo:rerun-if-env-changed=LUCKY_DRAW_ADMIN_PASSWORD");
    let password = std::env::var("LUCKY_DRAW_ADMIN_PASSWORD")
        .ok()
        .filter(|pw| !pw.is_empty())
        .unwrap_or_else(|| DEFAULT_ADMIN_PASSWORD.to_string());
    println!(
        "cargo:rustc-env=ADMIN_PASSWORD_HASH={}",
        password_hash::hash_admin_password(&password)
    );

    tauri_build::build()
}
