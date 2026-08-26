//! The token a client must present before the bridge will listen to it.
//!
//! The ACL already answers *who* may open the pipe: this user, on this machine,
//! and nobody else. The token answers a different question — **which of that
//! user's programs** — and it is the one the reader gets to decide. Without it,
//! any process running as them drives their atlas the moment the bridge is on,
//! and on a shared faculty machine "running as you" is a larger set than it
//! sounds.
//!
//! It is not a password and is not treated as a secret worth protecting at
//! rest. It is a per-session capability the reader can read off a panel and
//! paste into a client's configuration, and it dies with the session. The point
//! is consent, not confidentiality: a viewport that moves because a program the
//! reader never paired decided to move it is the failure being prevented.
//!
//! Nothing calls this yet, like the modules beside it.

#![cfg(windows)]
// No call site in the application yet. Removed by the commit that gives it one.
#![allow(dead_code)]

use std::fmt;

use serde_json::Value;

/// Bytes of entropy behind a token. 128 bits, which is not a considered
/// trade-off so much as the point past which the question stops being
/// interesting for a value that lives minutes and never leaves the machine.
const TOKEN_BYTES: usize = 16;

/// The frame a client sends first.
const PAIR: &str = "pair";

/// Why a client was not paired.
#[derive(Debug, PartialEq, Eq)]
pub enum PairingRefusal {
    /// The first line was not a `pair` frame. Carries what it was instead,
    /// because "send the pairing frame first" is the useful thing to say.
    NotAPairing(String),
    /// A `pair` frame with no `token` string in it.
    NoToken,
    /// A token that did not match.
    WrongToken,
}

impl fmt::Display for PairingRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAPairing(found) => {
                write!(f, "send a {PAIR:?} frame first, not {found:?}")
            }
            Self::NoToken => write!(f, "the pairing frame carries no token"),
            Self::WrongToken => write!(f, "that token does not match this session"),
        }
    }
}

/// Could not reach the operating system's randomness.
#[derive(Debug)]
pub struct NoRandomness;

impl fmt::Display for NoRandomness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the operating system would not provide random bytes")
    }
}

impl std::error::Error for NoRandomness {}

/// One session's pairing token.
pub struct Pairing {
    token: String,
}

impl Pairing {
    /// Mint a token from the operating system's randomness.
    ///
    /// Returned as a `Result` rather than falling back to something weaker.
    /// A predictable token is worse than no bridge at all, because it looks
    /// exactly like a working one — so if the OS will not answer, neither will
    /// this.
    pub fn new() -> Result<Self, NoRandomness> {
        let mut bytes = [0u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(|_| NoRandomness)?;
        let mut token = String::with_capacity(TOKEN_BYTES * 2);
        for byte in bytes {
            use fmt::Write;
            // Hex, because the reader copies this between two windows by hand
            // and every character has to survive being read aloud or retyped.
            let _ = write!(token, "{byte:02x}");
        }
        Ok(Self { token })
    }

    /// The token, to be shown to the reader and to nobody else.
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Whether an offered token is this session's.
    ///
    /// Compared in constant time. Not because a timing attack across a local
    /// named pipe by a process that already passed the ACL is a threat anybody
    /// should lose sleep over — it is five lines, and the alternative is a
    /// comparison whose safety depends on an argument rather than on the code.
    pub fn matches(&self, offered: &str) -> bool {
        let expected = self.token.as_bytes();
        let given = offered.as_bytes();
        // The length is fixed and public, so leaking it costs nothing.
        if expected.len() != given.len() {
            return false;
        }
        let mut difference = 0u8;
        for (a, b) in expected.iter().zip(given) {
            difference |= a ^ b;
        }
        difference == 0
    }

    /// Read a client's first line as a pairing attempt.
    pub fn admit(&self, line: &str) -> Result<(), PairingRefusal> {
        let parsed: Value = serde_json::from_str(line)
            .map_err(|_| PairingRefusal::NotAPairing("something that is not JSON".into()))?;

        match parsed.get("type").and_then(Value::as_str) {
            Some(PAIR) => {}
            Some(other) => return Err(PairingRefusal::NotAPairing(other.to_owned())),
            None => return Err(PairingRefusal::NotAPairing("a frame with no type".into())),
        }

        let offered = parsed
            .get("token")
            .and_then(Value::as_str)
            .ok_or(PairingRefusal::NoToken)?;

        if self.matches(offered) {
            Ok(())
        } else {
            Err(PairingRefusal::WrongToken)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn pairing() -> Pairing {
        Pairing::new().expect("the OS has randomness")
    }

    fn pair_frame(token: &str) -> String {
        format!(r#"{{"type":"pair","token":"{token}"}}"#)
    }

    #[test]
    fn a_token_is_thirty_two_hex_characters() {
        let token = pairing().token().to_owned();
        assert_eq!(token.len(), TOKEN_BYTES * 2);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn two_sessions_do_not_share_a_token() {
        // Weak in isolation — a broken generator could still pass this — but it
        // catches the failure that actually happens, which is a constant left
        // in by somebody testing something else.
        let minted: HashSet<String> = (0..64).map(|_| pairing().token().to_owned()).collect();
        assert_eq!(minted.len(), 64);
    }

    #[test]
    fn the_right_token_pairs() {
        let session = pairing();
        assert_eq!(session.admit(&pair_frame(session.token())), Ok(()));
    }

    #[test]
    fn another_sessions_token_does_not() {
        let session = pairing();
        let stranger = pairing();
        assert_eq!(
            session.admit(&pair_frame(stranger.token())),
            Err(PairingRefusal::WrongToken)
        );
    }

    #[test]
    fn a_prefix_of_the_token_does_not_pair() {
        // The comparison checks length before content, and this is the case
        // that would pass if it did not.
        let session = pairing();
        let short = &session.token()[..8];
        assert_eq!(
            session.admit(&pair_frame(short)),
            Err(PairingRefusal::WrongToken)
        );
    }

    #[test]
    fn an_empty_token_does_not_pair() {
        let session = pairing();
        assert_eq!(
            session.admit(&pair_frame("")),
            Err(PairingRefusal::WrongToken)
        );
    }

    #[test]
    fn a_scene_command_cannot_be_the_first_line() {
        // The property that makes this a gate rather than a formality: a client
        // that skips pairing and starts driving is refused, and told why.
        let session = pairing();
        assert_eq!(
            session.admit(r#"{"type":"scene_command","command":{"action":"reset_view"}}"#),
            Err(PairingRefusal::NotAPairing("scene_command".into()))
        );
    }

    #[test]
    fn a_pair_frame_with_no_token_is_named_as_such() {
        // Distinguished from a wrong token so a client can tell "you forgot the
        // field" from "you have the wrong value".
        let session = pairing();
        assert_eq!(
            session.admit(r#"{"type":"pair"}"#),
            Err(PairingRefusal::NoToken)
        );
    }

    #[test]
    fn rubbish_is_refused_without_panicking() {
        let session = pairing();
        for line in ["", "not json", "[]", "null", "{}"] {
            assert!(session.admit(line).is_err(), "{line:?} paired");
        }
    }

    #[test]
    fn matching_is_length_first_and_then_every_byte() {
        let session = pairing();
        let token = session.token().to_owned();
        assert!(session.matches(&token));

        // One character changed, in the last position — the one a comparison
        // that gave up early would never reach.
        let mut altered = token.clone();
        let last = altered.pop().expect("a token has characters");
        altered.push(if last == 'a' { 'b' } else { 'a' });
        assert!(!session.matches(&altered));

        assert!(!session.matches(&format!("{token}0")));
        assert!(!session.matches(""));
    }
}
