use crate::password_hash::hash_admin_password;

// Set by build.rs: the hash of LUCKY_DRAW_ADMIN_PASSWORD, or of the default.
const ADMIN_PASSWORD_HASH: &str = env!("ADMIN_PASSWORD_HASH");

#[tauri::command]
pub async fn verify_admin_password(password: String) -> bool {
    // Hashing is deliberately slow; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || hash_admin_password(&password) == ADMIN_PASSWORD_HASH)
        .await
        .unwrap_or(false)
}
