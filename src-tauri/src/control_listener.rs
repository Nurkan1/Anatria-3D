//! The accept loop: one thread, one client at a time, stopped on demand.
//!
//! This is the first piece of the bridge with state that outlives a function
//! call, which is the only reason it is a file of its own. Everything hard here
//! is about stopping — starting a thread that blocks on a pipe is four lines,
//! and getting it to come back is the rest.
//!
//! **Still no call site in the application.** The listener is built and tested
//! before anything starts one, so its presence cannot change what the app does.
//!
//! It does not know what a line means. Lines go to the handler exactly as they
//! arrived, and validating them against the manifest belongs a layer up, where
//! the atlas is in hand — see `anatria_engine::scene_contract` for the rule the
//! bridge will apply there.

#![cfg(windows)]
// No call site yet — see the module note. Removed by the commit that gives it
// one; still being here once the bridge exists means something was wired wrong.
#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use crate::control_pipe::{ControlClient, ControlPipe, PipeError, PipeHandle};

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
    pub fn start<F>(name: &str, mut on_line: F) -> Result<Self, PipeError>
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

                    loop {
                        match pipe.read_line() {
                            Ok(Some(line)) => on_line(&line),
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
        let (_seen, handler) = recorder();
        let listener = Listener::start(&unique_name(), handler).expect("started");
        stop_within(listener);
    }

    #[test]
    fn stopping_with_a_silent_client_attached_returns() {
        // The harder of the two: the thread is blocked in ReadFile on a client
        // that has connected and then said nothing. Connecting a second client
        // cannot help here, so this is the case that decides whether the
        // cancellation is doing real work.
        let (_seen, handler) = recorder();
        let listener = Listener::start(&unique_name(), handler).expect("started");
        let _client = ControlClient::connect(listener.name()).expect("connected");
        stop_within(listener);
    }

    #[test]
    fn a_line_reaches_the_handler() {
        let (seen, handler) = recorder();
        let listener = Listener::start(&unique_name(), handler).expect("started");
        let client = ControlClient::connect(listener.name()).expect("connected");

        client
            .write_line(r#"{"action":"reset_view"}"#)
            .expect("written");
        assert_eq!(wait_for(&seen, 1), vec![r#"{"action":"reset_view"}"#]);
    }

    #[test]
    fn a_client_leaving_does_not_end_the_listener() {
        // The property that makes this a listener rather than a one-shot. A
        // reader closing their agent and opening another one must not have to
        // restart Anatria3D.
        let (seen, handler) = recorder();
        let listener = Listener::start(&unique_name(), handler).expect("started");

        let first = ControlClient::connect(listener.name()).expect("first");
        first.write_line("one").expect("written");
        assert_eq!(wait_for(&seen, 1).len(), 1);
        drop(first);

        let second = ControlClient::connect(listener.name()).expect("second");
        second.write_line("two").expect("written");
        assert_eq!(wait_for(&seen, 2), vec!["one", "two"]);
    }

    #[test]
    fn a_client_that_floods_is_dropped_and_the_next_one_is_served() {
        // An over-long line ends that client's session, not the bridge. The
        // failure to avoid is one bad client taking the viewport away from
        // everybody until the application restarts.
        let (seen, handler) = recorder();
        let listener = Listener::start(&unique_name(), handler).expect("started");

        let flooding = ControlClient::connect(listener.name()).expect("connected");
        let filler = vec![b'x'; 8192];
        while flooding.write_raw(&filler).is_ok() {}
        drop(flooding);

        let polite = ControlClient::connect(listener.name()).expect("connected");
        polite.write_line("still here").expect("written");
        assert_eq!(wait_for(&seen, 1), vec!["still here"]);
    }

    #[test]
    fn dropping_the_listener_stops_it() {
        let name = unique_name();
        let (_seen, handler) = recorder();
        drop(Listener::start(&name, handler).expect("started"));

        // The pipe is gone with it, so a client can no longer find it.
        assert!(ControlClient::connect(&name).is_err());
    }
}
