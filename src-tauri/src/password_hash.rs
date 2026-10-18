// Shared by build.rs (hashes the admin password at build time) and the app
// (hashes what the operator types), so both sides always agree.
//
// Salted and iterated so the hash baked into the .exe isn't a quick lookup.

use sha2::{Digest, Sha256};

const SALT: &[u8] = b"lucky-draw-admin-v1";
const ROUNDS: u32 = 200_000;

pub fn hash_admin_password(password: &str) -> String {
    let mut digest = Sha256::new()
        .chain_update(SALT)
        .chain_update(password.as_bytes())
        .finalize();
    for _ in 1..ROUNDS {
        digest = Sha256::new().chain_update(SALT).chain_update(digest).finalize();
    }
    digest.iter().map(|b| format!("{b:02x}")).collect()
}
