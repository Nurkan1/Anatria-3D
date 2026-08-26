//! The accept loop: one thread, one client at a time, stopped on demand.
//!
//! This is the first piece of the bridge with state that outlives a function
//! call, which is the only reason it is a file of its own. Everything hard here
//! is about stopping — starting a thread that blocks on a pipe is four lines,
//! and getting it to come back is the rest.
//!
//! Started by `control_bridge` and by nothing else. What it hands the handler
//! is a line off the wire; whether that line is allowed anywhere near the
//! application is decided one layer up.
//!
//! It does not know what a line means. Lines go to the handler exactly as they
//! arrived, and validating them against the manifest belongs a layer up, where
//! the atlas is in hand — see `anatria_engine::scene_contract` for the rule the
//! bridge will apply there.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use crate::control_pairing::Pairing;
use crate::control_pipe::{ControlClient, ControlPipe, PipeError, PipeHandle};

/// Sent once a client's token is accepted.
///
/// A client has to know it may start driving, and the only alternative to
/// saying so is silence that looks identical to a token being ignored.
/// **This is the pairing handshake and nothing more** — whether an individual
/// command was applied is still not reported, and closing that is a separate
/// question with a separate answer.
pub const PAIRED: &str = r#"{"type":"paired"}"#;

/// A running accept loop.
///
/// Dropping one stops it. That is deliberate rather than convenient: a listener
/// whose owner has gone is a thread holding a pipe nobody can reach, and the
/// only thing worse than a bridge that will not start is one that will not
/// stop.
pub struct Listener {
    stopping: Arc<AtomicBool>,
    handle: Arc<PipeHandle>,
    name: String,
    thread: Option<JoinHandle<()>>,
}

impl Listener {
    /// Create the pipe and start accepting on a thread of its own.
    ///
    /// The pipe is created *here*, before the thread starts, so a failure to
    /// create it is returned to the caller rather than disappearing into a
    /// thread nobody is watching. By the time this returns, the pipe exists and
    /// a client can connect.
    pub fn start<F>(name: &str, pairing: Pairing, mut on_line: F) -> Result<Self, PipeError>
    where
        F: FnMut(&str) + Send + 'static,
    {
        let mut pipe = ControlPipe::create(name)?;
        let handle = pipe.shared_handle();
        let stopping = Arc::new(AtomicBool::new(false));

        let flag = Arc::clone(&stopping);
        let thread = std::thread::Builder::new()
            .name("anatria-control".into())
            .spawn(move || {
                while !flag.load(Ordering::SeqCst) {
                    // A failed accept is not worth a retry loop: the pipe is
                    // either being torn down or in a state this thread cannot
                    // mend, and spinning on it would burn a core quietly.
                    if pipe.wait_for_client().is_err() {
                        break;
                    }
                    if flag.load(Ordering::SeqCst) {
                        break;
                    }

                    // Every client pairs for itself. A token accepted for one
                    // is not remembered for the next, so a program that
                    // connects after a paired one has left starts from nothing.
                    let mut paired = false;

                    loop {
                        match pipe.read_line() {
                            Ok(Some(line)) if paired => on_line(&line),
                            Ok(Some(line)) => match pairing.admit(&line) {
                                Ok(()) => {
                                    paired = true;
                                    let _ = pipe.write_line(PAIRED);
                                }
                                // Refused, told why, and disconnected. Leaving
                                // the connection open would invite guessing at
                                // the token down the same pipe.
                                Err(why) => {
                                    let _ = pipe.write_line(&refusal(&why.to_string()));
                                    break;
                                }
                            },
                            // The client hung up, which is how a session
                            // ordinarily ends. Wait for the next one.
                            Ok(None) => break,
                            // Any error is this client's problem, not the
                            // listener's. Drop the client, keep serving.
                            Err(_) => break,
                        }
                        if flag.load(Ordering::SeqCst) {
                            break;
                        }
                    }

                    pipe.disconnect();
                }
            })
            .map_err(|_| PipeError::Create(0))?;

        Ok(Self {
            stopping,
            handle,
            name: name.to_owned(),
            thread: Some(thread),
        })
    }

    /// The pipe this listener is serving, as a client would name it.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Stop accepting and wait for the thread to finish.
    ///
    /// Two steps, because the thread can be blocked in either of two places and
    /// the flag alone reaches neither:
    ///
    /// 1. `CancelIoEx` breaks whatever the handle is sitting in — a `ReadFile`
    ///    waiting on a silent client, or a `ConnectNamedPipe` waiting for one
    ///    to arrive.
    /// 2. Opening the pipe ourselves and closing it again, in case there was
    ///    nothing pending to cancel at the instant we asked. The flag is set
    ///    first, so the loop sees it and exits rather than serving us.
    ///
    /// Calling it twice is fine, and dropping the listener calls it.
    pub fn stop(&mut self) {
        let Some(thread) = self.thread.take() else {
            return;
        };
        self.stopping.store(true, Ordering::SeqCst);
        self.handle.cancel_io();
        // Deliberately ignored: failing to connect means the loop is already
        // gone, which is the outcome this was trying to produce.
        drop(ControlClient::connect(&self.name));
        let _ = thread.join();
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A refusal a client can read, as one line of JSON.
fn refusal(reason: &str) -> String {
    serde_json::json!({ "type": "refused", "reason": reason }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    /// Long enough that a slow machine does not fail the suite, short enough
    /// that a genuine hang is a failure rather than a stuck CI job.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// How long to wait before concluding that nothing is going to arrive.
    ///
    /// Short, because every negative assertion pays it. It cannot prove a
    /// command will never be obeyed — only that it was not obeyed promptly,
    /// which is the difference between a gate and a slow gate, and is as much
    /// as a test of this shape can honestly say.
    const BRIEFLY: Duration = Duration::from_millis(300);

    fn unique_name() -> String {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        format!(
            "anatria3d-listener-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// A handler that records what it was given.
    fn recorder() -> (Arc<Mutex<Vec<String>>>, impl FnMut(&str) + Send + 'static) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let writing = Arc::clone(&seen);
        (seen, move |line: &str| {
            writing.lock().unwrap().push(line.to_owned());
        })
    }

    /// A running listener, the token a client will need, and what it heard.
    fn running() -> (Listener, String, Arc<Mutex<Vec<String>>>) {
        let (seen, handler) = recorder();
        let pairing = Pairing::new().expect("randomness");
        let token = pairing.token().to_owned();
        let listener = Listener::start(&unique_name(), pairing, handler).expect("started");
        (listener, token, seen)
    }

    fn pair_frame(token: &str) -> String {
        format!(r#"{{"type":"pair","token":"{token}"}}"#)
    }

    /// Connect and pair, the way a client is meant to.
    fn paired(listener: &Listener, token: &str) -> ControlClient {
        let client = ControlClient::connect(listener.name()).expect("connected");
        client.write_line(&pair_frame(token)).expect("paired");
        assert_eq!(client.read_line().expect("answer").as_deref(), Some(PAIRED));
        client
    }

    /// Wait for the handler to have seen `count` lines, or give up.
    ///
    /// Polled rather than synchronised: the listener hands lines over on its
    /// own thread, and a test that assumes it has already run is a test that
    /// passes on this machine and fails on a busier one.
    fn wait_for(seen: &Arc<Mutex<Vec<String>>>, count: usize) -> Vec<String> {
        let deadline = std::time::Instant::now() + PATIENCE;
        loop {
            let held = seen.lock().unwrap().clone();
            if held.len() >= count || std::time::Instant::now() > deadline {
                return held;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn heard_nothing(seen: &Arc<Mutex<Vec<String>>>) -> bool {
        std::thread::sleep(BRIEFLY);
        seen.lock().unwrap().is_empty()
    }

    /// Stop the listener on another thread, and fail rather than hang.
    ///
    /// A `stop` that never returns is the failure this file exists to prevent,
    /// so it must not be able to wedge the suite it is being tested by.
    fn stop_within(mut listener: Listener) {
        let (done, waiting) = mpsc::channel();
        std::thread::spawn(move || {
            listener.stop();
            let _ = done.send(());
        });
        assert!(
            waiting.recv_timeout(PATIENCE).is_ok(),
            "stop() did not return within {PATIENCE:?}"
        );
    }

    #[test]
    fn stopping_while_nobody_has_connected_returns() {
        // The thread is blocked in ConnectNamedPipe, which the stop flag alone
        // cannot reach.
        let (listener, _token, _seen) = running();
        stop_within(listener);
    }

    #[test]
    fn stopping_with_a_silent_client_attached_returns() {
        // The harder of the two: the thread is blocked in ReadFile on a client
        // that has connected and then said nothing. Connecting a second client
        // cannot help here, so this is the case that decides whether the
        // cancellation is doing real work.
        let (listener, _token, _seen) = running();
        let _client = ControlClient::connect(listener.name()).expect("connected");
        stop_within(listener);
    }

    #[test]
    fn a_paired_client_is_obeyed() {
        let (listener, token, seen) = running();
        let client = paired(&listener, &token);
        client
            .write_line(r#"{"action":"reset_view"}"#)
            .expect("written");
        assert_eq!(wait_for(&seen, 1), vec![r#"{"action":"reset_view"}"#]);
    }

    #[test]
    fn an_unpaired_client_is_not() {
        // The gate, and the reason the token exists at all: the ACL already let
        // this program open the pipe, because it runs as the same user. Consent
        // is the question the ACL cannot answer.
        let (listener, _token, seen) = running();
        let client = ControlClient::connect(listener.name()).expect("connected");
        client
            .write_line(r#"{"action":"reset_view"}"#)
            .expect("written");
        assert!(heard_nothing(&seen), "an unpaired command was obeyed");
    }

    #[test]
    fn a_client_that_guesses_wrong_is_told_and_dropped() {
        // Told, because silence is indistinguishable from a bridge that is off.
        // Dropped, because leaving the connection open invites a second guess
        // down the same pipe.
        let (listener, _token, seen) = running();
        let client = ControlClient::connect(listener.name()).expect("connected");
        client
            .write_line(&pair_frame("00000000000000000000000000000000"))
            .expect("written");

        let answer = client.read_line().expect("answer").unwrap_or_default();
        assert!(answer.contains("refused"), "not told: {answer:?}");

        // Either this fails because the connection is already gone, or it lands
        // in a pipe nobody is reading any more. Which one happens is a race
        // with the listener's disconnect, so neither is asserted — the outcome
        // that matters is the same either way.
        let _ = client.write_line(r#"{"action":"reset_view"}"#);
        assert!(heard_nothing(&seen), "a refused client was still obeyed");
    }

    #[test]
    fn pairing_does_not_carry_to_the_next_client() {
        // Per connection, not per session. Otherwise the second program to find
        // the pipe inherits the consent the reader gave the first.
        let (listener, token, seen) = running();
        let first = paired(&listener, &token);
        first.write_line("one").expect("written");
        assert_eq!(wait_for(&seen, 1).len(), 1);
        drop(first);

        let second = ControlClient::connect(listener.name()).expect("second");
        second.write_line("two").expect("written");
        std::thread::sleep(BRIEFLY);
        assert_eq!(
            seen.lock().unwrap().clone(),
            vec!["one"],
            "the second client inherited a pairing it never made"
        );
    }

    #[test]
    fn a_client_leaving_does_not_end_the_listener() {
        // The property that makes this a listener rather than a one-shot. A
        // reader closing their agent and opening another must not have to
        // restart Anatria3D.
        let (listener, token, seen) = running();

        let first = paired(&listener, &token);
        first.write_line("one").expect("written");
        assert_eq!(wait_for(&seen, 1).len(), 1);
        drop(first);

        let second = paired(&listener, &token);
        second.write_line("two").expect("written");
        assert_eq!(wait_for(&seen, 2), vec!["one", "two"]);
    }

    #[test]
    fn a_client_that_floods_is_dropped_and_the_next_one_is_served() {
        // An over-long line ends that client's session, not the bridge. The
        // failure to avoid is one bad client taking the viewport away from
        // everybody until the application restarts.
        let (listener, token, seen) = running();

        let flooding = ControlClient::connect(listener.name()).expect("connected");
        let filler = vec![b'x'; 8192];
        while flooding.write_raw(&filler).is_ok() {}
        drop(flooding);

        let polite = paired(&listener, &token);
        polite.write_line("still here").expect("written");
        assert_eq!(wait_for(&seen, 1), vec!["still here"]);
    }

    #[test]
    fn dropping_the_listener_stops_it() {
        let (listener, _token, _seen) = running();
        let name = listener.name().to_owned();
        drop(listener);

        // The pipe is gone with it, so a client can no longer find it.
        assert!(ControlClient::connect(&name).is_err());
    }
}
