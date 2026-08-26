//! What the bridge will let across, and what it rebuilds before it does.
//!
//! One rule: **the frame's `type` must be `scene_command`.** Everything else on
//! the engine's channel — `text_delta`, `done`, `error`, `case_verdict` — is
//! what the chat panel's state machine turns on, and a synthesised one is how
//! the composer gets hung on a turn that never happened. That is the whole
//! invariant, and it is a single string on purpose.
//!
//! **There is deliberately no list of actions here.** The fourteen live in Zod
//! and in Pydantic, joined by `tests/protocol-contract.test.ts`; a third copy in
//! Rust is exactly the drift the protocol has two owners to avoid. An action
//! this file never heard of is refused at the other end by
//! `SceneCommandSchema`, which is a discriminated union and cannot match one.
//!
//! Started by `control_bridge`, which is the only module that names this one.

#![cfg(windows)]

use std::fmt;

use serde_json::{json, Value};

/// The only frame type the bridge forwards.
const ADMITTED: &str = "scene_command";

/// Why a line was not forwarded.
///
/// Every variant is something a client can be told, because a command that
/// silently does nothing is the worst answer a bridge can give. What it cannot
/// report is an action the frontend later refuses — see the note on
/// [`admit`].
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    NotJson,
    NotAnObject,
    /// A frame of some other type. Carries the type so the client learns which.
    WrongType(String),
    NoType,
    NoCommand,
    NoAction,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotJson => write!(f, "not JSON"),
            Self::NotAnObject => write!(f, "not a JSON object"),
            Self::WrongType(found) => {
                write!(f, "only {ADMITTED} frames cross this bridge, not {found:?}")
            }
            Self::NoType => write!(f, "no \"type\" field"),
            Self::NoCommand => write!(f, "no \"command\" object"),
            Self::NoAction => write!(f, "the command names no \"action\""),
        }
    }
}

/// Check one line, and rebuild it as the frame the engine channel carries.
///
/// Rebuilt rather than forwarded as it arrived, for two reasons.
///
/// **The client does not get to choose the `request_id`.** Every other frame
/// type is correlated by it, and letting an external caller pick one is how a
/// bridge frame could be made to look like part of a conversation. The bridge
/// stamps its own, and it is recognisable on sight: a viewport that moves
/// unexpectedly should be traceable to the bridge or to the assistant without
/// guesswork.
///
/// **Anything else the client sent is dropped.** Three fields go across and no
/// others, so a field added to the wire format later cannot be smuggled through
/// by a client that learned about it before this code did.
///
/// What this cannot do is tell a client its *action* was refused. That happens
/// at the far end, where `SceneCommandSchema` fails to match and the frame is
/// logged as a protocol violation — correct, but silent from here. The control
/// server generates commands from the schema and so should not produce one;
/// a client that hand-rolls its frames can still be surprised.
pub fn admit(line: &str, request_id: &str) -> Result<String, Refusal> {
    let parsed: Value = serde_json::from_str(line).map_err(|_| Refusal::NotJson)?;
    let object = parsed.as_object().ok_or(Refusal::NotAnObject)?;

    match object.get("type").and_then(Value::as_str) {
        Some(ADMITTED) => {}
        Some(other) => return Err(Refusal::WrongType(other.to_owned())),
        None => return Err(Refusal::NoType),
    }

    let command = object
        .get("command")
        .filter(|value| value.is_object())
        .ok_or(Refusal::NoCommand)?;

    if command.get("action").and_then(Value::as_str).is_none() {
        return Err(Refusal::NoAction);
    }

    Ok(json!({
        "type": ADMITTED,
        "request_id": request_id,
        "command": command,
    })
    .to_string())
}

/// The `request_id` the bridge stamps on the frames it admits.
///
/// Prefixed rather than a bare UUID so it is obvious in a log which frames came
/// from outside the application. The counter distinguishes one command from the
/// next within a session, which is all it has to do — nothing downstream
/// correlates a `scene_command` by its id.
pub fn bridge_request_id(sequence: u64) -> String {
    format!("bridge-{sequence}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "bridge-1";

    fn admitted(line: &str) -> Value {
        serde_json::from_str(&admit(line, ID).expect("admitted")).expect("valid JSON out")
    }

    #[test]
    fn a_scene_command_crosses() {
        let out = admitted(
            r#"{"type":"scene_command","request_id":"x","command":{"action":"reset_view"}}"#,
        );
        assert_eq!(out["type"], "scene_command");
        assert_eq!(out["command"]["action"], "reset_view");
    }

    #[test]
    fn the_clients_request_id_is_replaced() {
        // Letting a caller choose it is how a bridge frame could be dressed up
        // as part of a conversation the reader is having.
        let out = admitted(
            r#"{"type":"scene_command","request_id":"pretending-to-be-a-chat-turn","command":{"action":"reset_view"}}"#,
        );
        assert_eq!(out["request_id"], ID);
    }

    #[test]
    fn a_frame_with_no_request_id_still_gets_one() {
        // `request_id` is required by the schema at the far end even though
        // nothing correlates a scene command by it, so a client that omits it
        // would otherwise be dropped as a protocol violation.
        let out = admitted(r#"{"type":"scene_command","command":{"action":"reset_view"}}"#);
        assert_eq!(out["request_id"], ID);
    }

    #[test]
    fn extra_fields_do_not_travel() {
        let out = admitted(
            r#"{"type":"scene_command","command":{"action":"reset_view"},"smuggled":"payload"}"#,
        );
        assert_eq!(out.as_object().expect("object").len(), 3);
        assert!(out.get("smuggled").is_none());
    }

    #[test]
    fn the_command_itself_is_passed_through_whole() {
        // The bridge does not edit commands. Whatever the action's own fields
        // are is between the client and the schema at the far end — this file
        // knowing them would be the third copy it exists to avoid.
        let out = admitted(
            r#"{"type":"scene_command","command":{"action":"isolate_structures","organ_ids":["a","b"]}}"#,
        );
        assert_eq!(out["command"]["organ_ids"][1], "b");
    }

    #[test]
    fn every_other_frame_type_is_refused() {
        // The invariant. `done` is the sharpest of them: one of those leaves
        // the composer believing a turn it never started has now finished.
        for kind in [
            "done",
            "text_delta",
            "error",
            "case_verdict",
            "ready",
            "models",
        ] {
            let line = format!(r#"{{"type":"{kind}","request_id":"x"}}"#);
            assert_eq!(
                admit(&line, ID),
                Err(Refusal::WrongType(kind.to_owned())),
                "a {kind} frame crossed the bridge"
            );
        }
    }

    #[test]
    fn a_frame_with_no_type_is_refused() {
        assert_eq!(
            admit(r#"{"command":{"action":"reset_view"}}"#, ID),
            Err(Refusal::NoType)
        );
    }

    #[test]
    fn a_command_that_is_not_an_object_is_refused() {
        assert_eq!(
            admit(r#"{"type":"scene_command","command":"reset_view"}"#, ID),
            Err(Refusal::NoCommand)
        );
    }

    #[test]
    fn a_command_with_no_action_is_refused() {
        assert_eq!(
            admit(
                r#"{"type":"scene_command","command":{"organ_id":"heart_l"}}"#,
                ID
            ),
            Err(Refusal::NoAction)
        );
    }

    #[test]
    fn rubbish_is_refused_rather_than_forwarded() {
        assert_eq!(admit("not json at all", ID), Err(Refusal::NotJson));
        assert_eq!(admit("", ID), Err(Refusal::NotJson));
        assert_eq!(admit("[1,2,3]", ID), Err(Refusal::NotAnObject));
        assert_eq!(admit("\"a string\"", ID), Err(Refusal::NotAnObject));
    }

    #[test]
    fn an_action_this_file_never_heard_of_still_crosses() {
        // Deliberate, and the reason there is no list here. Rust holding a
        // fourteenth copy of the action set is the drift the protocol keeps two
        // owners to avoid; an action the schema does not know is refused at the
        // far end by a discriminated union that cannot match it.
        //
        // If this test ever starts failing, somebody added a list to this file.
        let out = admitted(r#"{"type":"scene_command","command":{"action":"invent_a_new_organ"}}"#);
        assert_eq!(out["command"]["action"], "invent_a_new_organ");
    }

    #[test]
    fn the_stamped_id_says_where_the_frame_came_from() {
        assert_eq!(bridge_request_id(7), "bridge-7");
        assert!(bridge_request_id(0).starts_with("bridge-"));
    }
}
