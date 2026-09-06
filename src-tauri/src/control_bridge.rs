//! The switch: one bridge, off unless the reader turns it on.
//!
//! Everything under `control_*` up to now has been a piece with no owner. This
//! is the owner: the object the application manages, the settings panel reads,
//! and the two commands that start and stop it act on.
//!
//! # It does not know where the commands go
//!
//! The sink is supplied by the caller, and nothing in this file learns what
//! happens on the other side of it. That is not indirection for its own sake:
//! it is what let the whole bridge land and be tested while provably unable to
//! affect the application, with the connection to the viewport arriving
//! afterwards as a single closure body. `commands::start_bridge` holds it now.
//!
//! # Three rules the switch keeps
//!
//! - **Off unless asked.** Nothing starts this at launch, and no failure path
//!   turns it on. A reader who never opens the panel never has a pipe.
//! - **Off is off.** Stopping drops the listener and the pipe with it, so
//!   there is nothing left to connect to. The switch is the whole of the
//!   consent: it is the thing the reader can see, in a panel they opened, with
//!   a badge in the header for as long as it is on.
//! - **One pipe per user, not per machine.** The name carries the account's
//!   SID. Two people signed in at once — an ordinary thing on a shared faculty
//!   machine — each get their own, rather than the second finding the name
//!   taken by a pipe they are not allowed to open.

use serde::Serialize;
use std::fmt;

/// What the settings panel needs to draw the switch.
///
/// Nothing here is a credential. There was a per-session token once, and it
/// bought less than it cost: the pipe's own permissions already answer "is
/// this the reader's account", and *which of their programs* was a question
/// the reader had no way to act on — while a fresh token every session meant
/// editing a config file and restarting a client each time, which reads as a
/// broken feature rather than a security measure.
#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatus {
    /// Whether this build has a transport at all. False everywhere but Windows
    /// for now, and the panel says so rather than offering a switch that
    /// cannot work.
    pub supported: bool,
    pub running: bool,
    /// The full path a client connects to, or `None` when stopped.
    ///
    /// Shown for a reader writing a client of their own. The MCP server does
    /// not need it: the name is this account's SID, which any program running
    /// as the reader can work out for itself.
    pub pipe: Option<String>,
    /// Scene commands admitted since the bridge was started.
    pub accepted: u64,
    /// Lines refused: not a scene command, or malformed. Shown because a
    /// client that is connected and being ignored looks exactly like one that
    /// never connected, and the difference matters to whoever is debugging it.
    pub refused: u64,
}

impl BridgeStatus {
    /// The stopped state, on a platform that either has a transport or does not.
    fn stopped(supported: bool) -> Self {
        Self {
            supported,
            running: false,
            pipe: None,
            accepted: 0,
            refused: 0,
        }
    }
}

/// Why the bridge would not start.
///
/// Every variant reaches the reader as text in the panel. A switch that flips
/// back with no explanation is the failure this exists to avoid.
///
/// Which variants are reachable depends on the platform, and the two
/// allowances below say which way round: everything but `Unsupported` is built
/// by the Windows transport, and `Unsupported` is built only where there is
/// no transport to fail.
#[derive(Debug)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum BridgeError {
    /// No transport on this platform.
    #[cfg_attr(windows, allow(dead_code))]
    Unsupported,
    /// The account could not be identified, so the pipe could not be named or
    /// restricted to it.
    NoIdentity(String),
    /// The account's pipe name is already taken — a second window of this
    /// application, in practice, since nothing else may open it.
    ///
    /// Named rather than passed through as `Win32 231` because it is the one
    /// failure here an ordinary reader can cause and can fix, and a Win32 code
    /// tells them neither what happened nor what to do about it.
    AlreadyOpen,
    /// The pipe itself could not be created.
    Pipe(String),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(
                f,
                "this build has no control bridge; it is available on Windows"
            ),
            Self::NoIdentity(why) => write!(f, "could not identify this account: {why}"),
            Self::AlreadyOpen => write!(
                f,
                "another Anatria3D window signed in as you already has the bridge on. \
                 Turn it off there, or use that window."
            ),
            Self::Pipe(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for BridgeError {}

#[cfg(windows)]
mod platform {
    use super::{BridgeError, BridgeStatus};

    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use crate::control_acl;
    use crate::control_frame;
    use crate::control_listener::Listener;
    use crate::control_pipe::{pipe_path, PipeError, ERROR_PIPE_BUSY};

    /// The stem every instance's pipe name is built on. The account's SID is
    /// appended — see the module note on why it is per user.
    const PIPE_STEM: &str = "anatria3d-control";

    /// What one running bridge owns. Dropping this stops the accept loop, so
    /// there is no way to lose the listener while believing it stopped.
    struct Running {
        listener: Listener,
        tally: Arc<Tally>,
    }

    /// Counters shared with the accept loop's closure.
    #[derive(Default)]
    struct Tally {
        accepted: AtomicU64,
        refused: AtomicU64,
        /// Feeds the `request_id` the bridge stamps on each admitted frame.
        sequence: AtomicU64,
    }

    /// The application's one bridge.
    ///
    /// A `Mutex<Option<_>>` rather than anything cleverer: start and stop come
    /// from the webview, arrive on whatever thread Tauri picked, and are rare.
    /// The only property that matters is that two starts cannot both create a
    /// pipe.
    #[derive(Default)]
    pub struct ControlBridge {
        running: Mutex<Option<Running>>,
        /// The pipe name to use, when it is not this account's.
        ///
        /// Only the tests set it, and they must: the real name is fixed per
        /// account, so two bridges cannot exist at once — which is the correct
        /// behaviour for an application and useless for a test suite that runs
        /// its cases in parallel.
        stem: Option<String>,
    }

    impl ControlBridge {
        /// What the panel should draw.
        pub fn status(&self) -> BridgeStatus {
            let running = self.locked();
            match running.as_ref() {
                None => BridgeStatus::stopped(true),
                Some(state) => BridgeStatus {
                    supported: true,
                    running: true,
                    pipe: Some(pipe_path(state.listener.name())),
                    accepted: state.tally.accepted.load(Ordering::Relaxed),
                    refused: state.tally.refused.load(Ordering::Relaxed),
                },
            }
        }

        /// Turn it on, and hand every admitted command to `on_command`.
        ///
        /// Idempotent: starting a running bridge returns its current state
        /// rather than tearing the listener down and building another. A panel
        /// that double-fires must not drop a client that is mid-conversation.
        ///
        /// `on_command` receives the *rebuilt* frame — `control_frame::admit`
        /// has already checked its type, dropped every field but the three the
        /// protocol carries, and stamped a `request_id` of the bridge's own
        /// choosing. It never receives a client's line as it arrived.
        pub fn start<F>(&self, on_command: F) -> Result<BridgeStatus, BridgeError>
        where
            F: Fn(String) + Send + 'static,
        {
            let mut running = self.locked();
            if running.is_some() {
                drop(running);
                return Ok(self.status());
            }

            let name = match self.stem.as_deref() {
                Some(stem) => stem.to_owned(),
                None => pipe_name()?,
            };
            let tally = Arc::new(Tally::default());
            let counters = Arc::clone(&tally);

            let listener = Listener::start(&name, move |line| {
                let sequence = counters.sequence.fetch_add(1, Ordering::Relaxed);
                match control_frame::admit(line, &control_frame::bridge_request_id(sequence)) {
                    Ok(frame) => {
                        counters.accepted.fetch_add(1, Ordering::Relaxed);
                        on_command(frame);
                    }
                    // Counted rather than logged. What a paired program sent is
                    // the reader's business and can carry a patient's details;
                    // that it was refused is all this side needs to know.
                    Err(_) => {
                        counters.refused.fetch_add(1, Ordering::Relaxed);
                    }
                }
            })
            .map_err(|err| match err {
                // The name is taken, and by construction only this account may
                // hold it — so the other holder is another window of this app.
                PipeError::Create(ERROR_PIPE_BUSY) => BridgeError::AlreadyOpen,
                other => BridgeError::Pipe(other.to_string()),
            })?;

            *running = Some(Running { listener, tally });
            drop(running);
            Ok(self.status())
        }

        /// Turn it off, and give up the pipe with it.
        ///
        /// There is nothing left to connect to afterwards, which is the whole
        /// of what "off" has to mean.
        ///
        /// Safe to call when already stopped, which is what makes it usable
        /// from the shutdown path without asking first.
        pub fn stop(&self) {
            // Dropped outside the lock. `Listener::drop` joins the accept
            // thread, and holding the bridge's own lock while waiting on
            // another thread is how a shutdown turns into a hang.
            let taken = self.locked().take();
            drop(taken);
        }

        /// A bridge on a pipe name nothing else will claim.
        ///
        /// Tests only, and the reason is the behaviour under test elsewhere:
        /// the real name is one per account, so a suite running in parallel
        /// would have every case after the first fail with `AlreadyOpen`.
        #[cfg(test)]
        fn for_test() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let unique = NEXT.fetch_add(1, Ordering::Relaxed);
            Self {
                running: Mutex::new(None),
                stem: Some(format!("{PIPE_STEM}-test-{}-{unique}", std::process::id())),
            }
        }

        /// The lock, recovered rather than propagated.
        ///
        /// A panicking accept loop must not make the switch permanently
        /// unusable: the data behind this lock is a handle and two counters,
        /// and there is no invariant across them that a panic could have left
        /// half-applied.
        fn locked(&self) -> std::sync::MutexGuard<'_, Option<Running>> {
            self.running
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        }
    }

    /// This account's pipe name.
    fn pipe_name() -> Result<String, BridgeError> {
        let sid = control_acl::current_user_sid()
            .map_err(|err| BridgeError::NoIdentity(err.to_string()))?;
        Ok(format!("{PIPE_STEM}-{sid}"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::control_pipe::ControlClient;
        use std::sync::mpsc;
        use std::time::Duration;

        /// Long enough that a loaded CI runner does not fail a passing test,
        /// short enough that a genuinely stuck one does not hang the suite.
        const PATIENCE: Duration = Duration::from_secs(5);

        fn scene_command(action: &str) -> String {
            format!(r#"{{"type":"scene_command","command":{{"action":"{action}"}}}}"#)
        }

        #[test]
        fn a_new_bridge_is_off() {
            let bridge = ControlBridge::for_test();
            let status = bridge.status();
            assert!(status.supported);
            assert!(!status.running);
            assert!(status.pipe.is_none());
        }

        #[test]
        fn starting_names_a_pipe() {
            let bridge = ControlBridge::for_test();
            let status = bridge.start(|_| {}).expect("started");
            assert!(status.running);
            assert!(status
                .pipe
                .as_deref()
                .expect("a pipe path")
                .starts_with(r"\\.\pipe\"));
            bridge.stop();
        }

        #[test]
        fn the_pipe_is_named_for_this_account() {
            // The property, not the value: a name that did not vary by account
            // would collide between two people signed in at once, and each
            // would be denied the other's pipe by its DACL.
            let sid = control_acl::current_user_sid().expect("this process has an identity");
            assert!(pipe_name().expect("a name").ends_with(&sid));
        }

        #[test]
        fn stopping_gives_up_the_pipe() {
            let bridge = ControlBridge::for_test();
            let started = bridge.start(|_| {}).expect("started");
            let path = started.pipe.expect("a pipe path");

            bridge.stop();

            let status = bridge.status();
            assert!(!status.running);
            // The name is free again, which is the whole of what "off" means
            // now that there is no credential to invalidate alongside it.
            assert!(
                ControlClient::connect_now(name_of(&path)).is_err(),
                "the pipe outlived the bridge"
            );
        }

        #[test]
        fn a_second_start_keeps_the_listener_it_already_had() {
            // A panel that fires twice must not tear down a listener a client
            // is mid-conversation with.
            let bridge = ControlBridge::for_test();
            let first = bridge.start(|_| {}).expect("started");
            let second = bridge.start(|_| {}).expect("still started");
            assert_eq!(first.pipe, second.pipe);
            bridge.stop();
        }

        #[test]
        fn a_connected_client_reaches_the_sink() {
            let (tx, rx) = mpsc::channel();
            let bridge = ControlBridge::for_test();
            let status = bridge
                .start(move |frame| {
                    let _ = tx.send(frame);
                })
                .expect("started");

            let client = ControlClient::connect(name_of(status.pipe.as_deref().expect("a path")))
                .expect("connected");
            client
                .write_line(&scene_command("reset_view"))
                .expect("the command was sent");

            let frame = rx.recv_timeout(PATIENCE).expect("the sink received it");
            let parsed: serde_json::Value =
                serde_json::from_str(&frame).expect("the sink receives valid JSON");
            assert_eq!(parsed["type"], "scene_command");
            assert_eq!(parsed["command"]["action"], "reset_view");
            // Stamped by the bridge, so a frame that moves the viewport can
            // always be told apart from one the assistant produced.
            assert_eq!(parsed["request_id"], "bridge-0");

            drop(client);
            bridge.stop();
            assert_eq!(
                bridge.status().accepted,
                0,
                "the counters died with the run"
            );
        }

        #[test]
        fn what_is_not_a_scene_command_is_counted_and_dropped() {
            let (tx, rx) = mpsc::channel();
            let bridge = ControlBridge::for_test();
            let status = bridge
                .start(move |frame| {
                    let _ = tx.send(frame);
                })
                .expect("started");

            let client = ControlClient::connect(name_of(status.pipe.as_deref().expect("a path")))
                .expect("connected");

            // A `done` frame is the sharpest of these: one reaching the
            // frontend would tell the composer a turn it never started has
            // finished.
            client
                .write_line(r#"{"type":"done","request_id":"x"}"#)
                .expect("sent");
            client.write_line("not json at all").expect("sent");
            // Followed by a real one, so the assertion does not pass merely
            // because nothing had arrived yet.
            client
                .write_line(&scene_command("reset_view"))
                .expect("sent");

            let frame = rx
                .recv_timeout(PATIENCE)
                .expect("the scene command arrived");
            assert!(frame.contains("reset_view"));
            assert!(
                rx.try_recv().is_err(),
                "something other than the scene command reached the sink"
            );

            let status = bridge.status();
            assert_eq!(status.accepted, 1);
            assert_eq!(status.refused, 2);

            drop(client);
            bridge.stop();
        }

        #[test]
        fn each_admitted_frame_gets_its_own_id() {
            let (tx, rx) = mpsc::channel();
            let bridge = ControlBridge::for_test();
            let status = bridge
                .start(move |frame| {
                    let _ = tx.send(frame);
                })
                .expect("started");

            let client = ControlClient::connect(name_of(status.pipe.as_deref().expect("a path")))
                .expect("connected");
            for _ in 0..3 {
                client
                    .write_line(&scene_command("reset_view"))
                    .expect("sent");
            }

            let mut ids = Vec::new();
            for _ in 0..3 {
                let frame = rx.recv_timeout(PATIENCE).expect("a frame");
                let parsed: serde_json::Value = serde_json::from_str(&frame).expect("JSON");
                ids.push(parsed["request_id"].as_str().expect("an id").to_owned());
            }
            assert_eq!(ids, vec!["bridge-0", "bridge-1", "bridge-2"]);

            drop(client);
            bridge.stop();
        }

        /// The bare name inside a `\\.\pipe\…` path, which is what a client
        /// takes. The panel shows the whole path because that is what a client
        /// configuration wants.
        fn name_of(path: &str) -> &str {
            path.rsplit('\\').next().expect("a pipe name")
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{BridgeError, BridgeStatus};

    /// The bridge on a platform with no transport for it yet.
    ///
    /// Present rather than compiled away so the command surface, the panel and
    /// this file's shape are identical everywhere — the reader on Linux is told
    /// there is no bridge, which is a different thing from a switch that
    /// silently does nothing.
    ///
    /// A Unix socket with mode 0600 is the obvious counterpart and is not here
    /// yet, because the gates run on Windows only and an untested transport
    /// listening on a socket is worse than an honest absence.
    #[derive(Default)]
    pub struct ControlBridge {
        // Keep Default construction uniform with the Windows implementation.
        _private: (),
    }

    impl ControlBridge {
        pub fn status(&self) -> BridgeStatus {
            BridgeStatus::stopped(false)
        }

        pub fn start<F>(&self, _on_command: F) -> Result<BridgeStatus, BridgeError>
        where
            F: Fn(String) + Send + 'static,
        {
            Err(BridgeError::Unsupported)
        }

        pub fn stop(&self) {}
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn there_is_no_bridge_here_and_it_says_so() {
            let bridge = ControlBridge::default();
            let status = bridge.status();
            assert!(!status.supported);
            assert!(!status.running);
            assert!(bridge.start(|_| {}).is_err());
            // Callable regardless, so the shutdown path needs no platform test.
            bridge.stop();
        }
    }
}

pub use platform::ControlBridge;
