//! API key storage in the operating system's credential store.
//!
//! The security property this module exists to enforce: **the frontend can
//! write a key and ask whether one exists, but can never read one back.**
//! There is deliberately no `get` command exposed to the webview — the only
//! reader is [`read`], which is crate-private and used solely to inject the key
//! into the sidecar's stdin. A compromised or injected script in the webview
//! therefore has nothing to exfiltrate.

use serde::{Deserialize, Serialize};

/// Service name under which credentials are filed. Shows up as the entry name
/// in Windows Credential Manager / macOS Keychain, so it is user-facing.
const SERVICE: &str = "Anatria3D";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Google,
}

impl Provider {
    /// Account name within the service entry.
    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Google => "google",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KeyringError {
    #[error("no API key stored for this provider")]
    NotFound,
    #[error("credential store unavailable: {0}")]
    Backend(String),
    #[error("API key must not be empty")]
    Empty,
}

impl serde::Serialize for KeyringError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

fn entry(provider: Provider) -> Result<keyring::Entry, KeyringError> {
    keyring::Entry::new(SERVICE, provider.account())
        .map_err(|e| KeyringError::Backend(e.to_string()))
}

pub fn store(provider: Provider, api_key: &str) -> Result<(), KeyringError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(KeyringError::Empty);
    }
    entry(provider)?
        .set_password(trimmed)
        .map_err(|e| KeyringError::Backend(e.to_string()))
}

/// Crate-private on purpose — see the module docs. Never expose as a command.
pub(crate) fn read(provider: Provider) -> Result<String, KeyringError> {
    match entry(provider)?.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => Err(KeyringError::NotFound),
        Err(e) => Err(KeyringError::Backend(e.to_string())),
    }
}

pub fn exists(provider: Provider) -> bool {
    read(provider).is_ok()
}

pub fn delete(provider: Provider) -> Result<(), KeyringError> {
    match entry(provider)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting an absent key is a no-op, not an error — the caller's
        // desired end state (no key stored) already holds.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(KeyringError::Backend(e.to_string())),
    }
}
