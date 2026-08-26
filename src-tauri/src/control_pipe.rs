//! The control bridge's named pipe: creating it, and reading lines off it.
//!
//! The transport knows nothing about scene commands. It moves newline-delimited
//! bytes and enforces two limits — one client, and a bounded line — which is
//! deliberately all it does. What a line *means* is decided a layer up, where
//! the manifest is in hand.
//!
//! **Still nothing in the application calls this.** Like [`crate::control_acl`]
//! beside it, this is landed and tested before it has a caller, so its presence
//! cannot change what the app does.
//!
//! Two independent defences keep the pipe local, and they are independent on
//! purpose:
//!
//! - the DACL denies network logon users, from `control_acl`
//! - `PIPE_REJECT_REMOTE_CLIENTS` refuses a remote open at the pipe itself
//!
//! Either alone would do. Both, because the first is a string somebody could
//! edit and the second is a flag the kernel enforces, and they fail in
//! different ways.

#![cfg(windows)]

use std::ffi::c_void;
use std::fmt;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use std::sync::Arc;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HANDLE,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
    SE_KERNEL_OBJECT,
};
use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_SHARE_NONE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, WaitNamedPipeW, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows_sys::Win32::System::IO::CancelIoEx;

use crate::control_acl::SecurityAttributes;

/// The longest line the bridge will assemble before giving up on a client.
///
/// A scene command is a few hundred bytes; the largest legitimate one is an
/// `isolate_structures` naming sixty-four identifiers, which does not approach
/// this. The cap is not a guess at what commands need — it is the answer to a
/// client that opens the pipe and never sends a newline, which without a limit
/// is a process quietly growing a buffer until the machine notices.
pub const MAX_LINE: usize = 64 * 1024;

/// How many clients may be connected at once. One, on purpose.
///
/// Two agents driving one viewport is not a feature with a confusing edge case,
/// it is two agents driving one viewport. A second client waits.
const MAX_INSTANCES: u32 = 1;

/// What went wrong on the pipe. Every variant carries the Win32 code.
#[derive(Debug)]
pub enum PipeError {
    Create(u32),
    Connect(u32),
    Read(u32),
    Write(u32),
    Security(u32),
    /// A client sent [`MAX_LINE`] bytes with no newline in them.
    LineTooLong,
}

impl fmt::Display for PipeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Create(code) => write!(f, "could not create the pipe (Win32 {code})"),
            Self::Connect(code) => write!(f, "could not accept a client (Win32 {code})"),
            Self::Read(code) => write!(f, "could not read from the pipe (Win32 {code})"),
            Self::Write(code) => write!(f, "could not write to the pipe (Win32 {code})"),
            Self::Security(code) => write!(f, "could not read the pipe's DACL (Win32 {code})"),
            Self::LineTooLong => write!(f, "a line exceeded {MAX_LINE} bytes without a newline"),
        }
    }
}

impl std::error::Error for PipeError {}

/// A null-terminated UTF-16 buffer, as every `…W` entry point wants.
fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// The full pipe path for a bare name: `\\.\pipe\<name>`.
pub fn pipe_path(name: &str) -> String {
    format!(r"\\.\pipe\{name}")
}

/// The kernel handle, and the only thing that closes it.
///
/// Split from [`ControlPipe`] so the accept loop and whatever stops it can hold
/// the same handle without racing over its lifetime. Stopping means cancelling
/// a blocking read from another thread, and cancelling a handle that has just
/// been closed is how a process ends up cancelling I/O on somebody else's
/// object — handles are reused. An `Arc` makes that impossible to write.
pub struct PipeHandle {
    handle: HANDLE,
}

impl PipeHandle {
    fn raw(&self) -> HANDLE {
        self.handle
    }

    /// Break whatever blocking call this handle is sitting in.
    ///
    /// Best effort by nature: there may be nothing pending, in which case it
    /// fails and there was nothing to do. The caller checks its own stop flag
    /// afterwards rather than trusting this to have worked.
    pub fn cancel_io(&self) {
        // SAFETY: the handle is alive for as long as this `Arc` is, which is
        // the whole reason the type exists.
        unsafe { CancelIoEx(self.handle, ptr::null()) };
    }
}

impl Drop for PipeHandle {
    fn drop(&mut self) {
        if self.handle != INVALID_HANDLE_VALUE && !self.handle.is_null() {
            // SAFETY: opened by CreateNamedPipeW, closed exactly once here,
            // and the `Arc` guarantees nobody else is still using it.
            unsafe { CloseHandle(self.handle) };
        }
    }
}

// SAFETY: a Windows HANDLE is a process-wide table index, not a pointer into
// this process's memory, and the calls made through it are thread-safe at the
// kernel. Sharing one across threads is the ordinary way a listener is run.
unsafe impl Send for PipeHandle {}
unsafe impl Sync for PipeHandle {}

/// One end of the control pipe, owned by the application.
pub struct ControlPipe {
    handle: Arc<PipeHandle>,
    /// Bytes read but not yet returned as a line. A read returns whatever
    /// arrived, which has no reason to align with a newline.
    pending: Vec<u8>,
}

impl ControlPipe {
    /// Create the pipe, with the current user as the only permitted opener.
    ///
    /// The security attributes are built and dropped inside this call: Windows
    /// copies the descriptor into the kernel object, so the pipe outlives the
    /// struct that described it. [`Self::dacl_sddl`] reads back what the object
    /// actually carries, which is the only way to be sure of that.
    pub fn create(name: &str) -> Result<Self, PipeError> {
        let security = SecurityAttributes::owner_only()
            .map_err(|_| PipeError::Security(unsafe { GetLastError() }))?;
        let path = wide(&pipe_path(name));

        // SAFETY: `path` is a null-terminated UTF-16 string alive for the call,
        // and `security` outlives it by one statement.
        let handle = unsafe {
            CreateNamedPipeW(
                path.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                MAX_INSTANCES,
                MAX_LINE as u32,
                MAX_LINE as u32,
                0,
                security.as_ptr(),
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            return Err(PipeError::Create(unsafe { GetLastError() }));
        }

        Ok(Self {
            handle: Arc::new(PipeHandle { handle }),
            pending: Vec::new(),
        })
    }

    /// Block until a client opens the pipe.
    ///
    /// `ERROR_PIPE_CONNECTED` (535) is success wearing a failure's clothes: it
    /// means the client got there first, between the create and this call.
    pub fn wait_for_client(&self) -> Result<(), PipeError> {
        const ERROR_PIPE_CONNECTED: u32 = 535;
        // SAFETY: `self.handle` is a pipe this struct owns and has not closed.
        if unsafe { ConnectNamedPipe(self.handle.raw(), ptr::null_mut()) } != 0 {
            return Ok(());
        }
        match unsafe { GetLastError() } {
            ERROR_PIPE_CONNECTED => Ok(()),
            code => Err(PipeError::Connect(code)),
        }
    }

    /// The next newline-delimited line, or `None` when the client has gone.
    ///
    /// The trailing newline is stripped; a `\r` before it is too, because a
    /// client written on Windows will send one and a JSON parser should not
    /// have to care which platform its peer was built on.
    pub fn read_line(&mut self) -> Result<Option<String>, PipeError> {
        loop {
            if let Some(at) = self.pending.iter().position(|byte| *byte == b'\n') {
                let mut line: Vec<u8> = self.pending.drain(..=at).collect();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Ok(Some(String::from_utf8_lossy(&line).into_owned()));
            }

            // Checked before reading more, not after: the point is to refuse a
            // client that never sends a newline, and that client is recognised
            // by the buffer standing at the cap with nothing to return.
            if self.pending.len() >= MAX_LINE {
                return Err(PipeError::LineTooLong);
            }

            let mut chunk = [0u8; 4096];
            let mut read = 0u32;
            // SAFETY: `chunk` is a valid buffer of the length passed, and
            // `read` is a valid out-pointer.
            let ok = unsafe {
                ReadFile(
                    self.handle.raw(),
                    chunk.as_mut_ptr(),
                    chunk.len() as u32,
                    &mut read,
                    ptr::null_mut(),
                )
            };

            if ok == 0 {
                // The client closing its end is the ordinary way a session
                // ends, not an error to report upwards.
                const ERROR_BROKEN_PIPE: u32 = 109;
                return match unsafe { GetLastError() } {
                    ERROR_BROKEN_PIPE => Ok(None),
                    code => Err(PipeError::Read(code)),
                };
            }
            if read == 0 {
                return Ok(None);
            }
            self.pending.extend_from_slice(&chunk[..read as usize]);
        }
    }

    /// Send one line back, newline included.
    pub fn write_line(&self, line: &str) -> Result<(), PipeError> {
        let payload = format!("{line}\n");
        let bytes = payload.as_bytes();
        let mut written = 0u32;
        // SAFETY: `bytes` is alive for the call and `written` is a valid
        // out-pointer.
        let ok = unsafe {
            WriteFile(
                self.handle.raw(),
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(PipeError::Write(unsafe { GetLastError() }));
        }
        Ok(())
    }

    /// Drop the current client, leaving the pipe open for the next one.
    pub fn disconnect(&mut self) {
        self.pending.clear();
        // SAFETY: `self.handle` is a pipe this struct owns and has not closed.
        unsafe { DisconnectNamedPipe(self.handle.raw()) };
    }

    /// The DACL the **kernel object** carries, in SDDL form.
    ///
    /// Not the string we asked for — what the pipe ended up with. Those are
    /// different claims, and only this one answers "is the pipe actually
    /// private". It stays public rather than living in the tests because it is
    /// also the thing worth printing when somebody reports that the bridge let
    /// in a client it should not have.
    #[allow(dead_code)]
    pub fn dacl_sddl(&self) -> Result<String, PipeError> {
        let mut descriptor: *mut c_void = ptr::null_mut();
        // SAFETY: every out-parameter is either a valid pointer or null, which
        // GetSecurityInfo documents as "do not return this".
        let status = unsafe {
            GetSecurityInfo(
                self.handle.raw(),
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(PipeError::Security(status));
        }

        let mut text: *mut u16 = ptr::null_mut();
        // SAFETY: `descriptor` came back from a successful GetSecurityInfo.
        let ok = unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            // SAFETY: GetSecurityInfo allocated it and nothing else freed it.
            unsafe { LocalFree(descriptor) };
            return Err(PipeError::Security(code));
        }

        let mut len = 0usize;
        // SAFETY: `text` is a null-terminated UTF-16 string from the call above.
        while unsafe { *text.add(len) } != 0 {
            len += 1;
        }
        let sddl = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
        // SAFETY: both were allocated by the calls above and are freed once.
        unsafe {
            LocalFree(text as *mut c_void);
            LocalFree(descriptor);
        }
        Ok(sddl)
    }
}

impl ControlPipe {
    /// A second reference to the handle, for whatever needs to interrupt this
    /// pipe from another thread. It cannot close it: only the last `Arc` does.
    pub fn shared_handle(&self) -> Arc<PipeHandle> {
        Arc::clone(&self.handle)
    }
}

/// The client end, for tests and for anything of ours that has to talk to the
/// bridge. A real external client opens the same path with its own runtime.
pub struct ControlClient {
    handle: HANDLE,
}

/// How long a client waits for the single instance to come free.
///
/// Generous, because the thing it waits for is measured in microseconds: the
/// listener disconnecting one client and looping back round to accept the
/// next. A timeout this long only expires when something is genuinely wedged.
const BUSY_PATIENCE_MS: u32 = 2_000;

/// Win32 `ERROR_PIPE_BUSY`: every instance is in use.
///
/// Returned by two different calls for two different reasons. From a client it
/// means "a moment early, try again"; from `CreateNamedPipeW` it means the name
/// is already taken by a listener that is not ours, which is not a retry —
/// see `control_bridge`, which turns that one into a sentence.
pub const ERROR_PIPE_BUSY: u32 = 231;

impl ControlClient {
    /// Open the pipe, waiting if the single instance is momentarily taken.
    ///
    /// **The wait is not optional politeness, it is the protocol.** With one
    /// instance, a client that reconnects the instant another leaves arrives
    /// before the listener has finished disconnecting the last one and gone
    /// back to accepting, and gets `ERROR_PIPE_BUSY` — not because anything is
    /// wrong, but because it was a moment early. `WaitNamedPipeW` is the Win32
    /// answer and any client of this bridge has to do the same, ours or not.
    /// It is written down here because an external client will meet it.
    pub fn connect(name: &str) -> Result<Self, PipeError> {
        match Self::connect_now(name) {
            Err(PipeError::Connect(ERROR_PIPE_BUSY)) => {}
            other => return other,
        }

        let path = wide(&pipe_path(name));
        // SAFETY: `path` is a null-terminated UTF-16 string alive for the call.
        // A false return means the wait timed out; the retry below then reports
        // whatever the real reason turns out to be.
        unsafe { WaitNamedPipeW(path.as_ptr(), BUSY_PATIENCE_MS) };
        Self::connect_now(name)
    }

    /// Open the pipe, or fail immediately if it is busy.
    ///
    /// Separate from [`Self::connect`] so a test can observe the one-client
    /// rule rather than having it waited away.
    pub fn connect_now(name: &str) -> Result<Self, PipeError> {
        let path = wide(&pipe_path(name));
        // SAFETY: `path` is a null-terminated UTF-16 string alive for the call.
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_NONE,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(PipeError::Connect(unsafe { GetLastError() }));
        }
        Ok(Self { handle })
    }

    /// Send one line. Exercised by the tests, which are the only client
    /// this build ships; an external one makes the same three calls.
    #[allow(dead_code)]
    pub fn write_line(&self, line: &str) -> Result<(), PipeError> {
        let payload = format!("{line}\n");
        let bytes = payload.as_bytes();
        let mut written = 0u32;
        // SAFETY: `bytes` is alive for the call, `written` is a valid
        // out-pointer.
        let ok = unsafe {
            WriteFile(
                self.handle,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(PipeError::Write(unsafe { GetLastError() }));
        }
        Ok(())
    }

    /// Read one line the bridge sent back.
    ///
    /// Blocking, and deliberately unbuffered beyond a single read: the only
    /// things the bridge says are one-line handshake answers, and a client that
    /// needs streaming is not this one.
    #[allow(dead_code)]
    pub fn read_line(&self) -> Result<Option<String>, PipeError> {
        let mut chunk = [0u8; 4096];
        let mut read = 0u32;
        // SAFETY: `chunk` is a valid buffer of the length passed, and `read` is
        // a valid out-pointer.
        let ok = unsafe {
            ReadFile(
                self.handle,
                chunk.as_mut_ptr(),
                chunk.len() as u32,
                &mut read,
                ptr::null_mut(),
            )
        };
        if ok == 0 || read == 0 {
            return Ok(None);
        }
        Ok(Some(
            String::from_utf8_lossy(&chunk[..read as usize])
                .trim_end()
                .to_owned(),
        ))
    }

    /// Write raw bytes with no newline appended. Tests use it to be a badly
    /// behaved client on purpose.
    #[allow(dead_code)]
    pub fn write_raw(&self, bytes: &[u8]) -> Result<(), PipeError> {
        let mut written = 0u32;
        // SAFETY: `bytes` is alive for the call, `written` is a valid
        // out-pointer.
        let ok = unsafe {
            WriteFile(
                self.handle,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(PipeError::Write(unsafe { GetLastError() }));
        }
        Ok(())
    }
}

// SAFETY: a Windows HANDLE is a process-wide table index, not a pointer into
// this process's memory, and every call this type makes is thread-safe at the
// kernel. Moving one to another thread is the ordinary way a listener is run.
unsafe impl Send for ControlClient {}

impl Drop for ControlClient {
    fn drop(&mut self) {
        if self.handle != INVALID_HANDLE_VALUE && !self.handle.is_null() {
            // SAFETY: opened by CreateFileW, closed exactly once here.
            unsafe { CloseHandle(self.handle) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Pipe names are a machine-wide namespace, so tests running in parallel
    /// must not share one.
    fn unique_name() -> String {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        format!(
            "anatria3d-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Create a pipe, connect a client, and hand both back.
    ///
    /// The client has to connect from another thread because
    /// `wait_for_client` blocks until it does.
    fn connected() -> (ControlPipe, ControlClient) {
        let name = unique_name();
        let pipe = ControlPipe::create(&name).expect("pipe created");

        let joining = std::thread::spawn(move || ControlClient::connect(&name));
        pipe.wait_for_client().expect("client accepted");
        let client = joining.join().expect("client thread").expect("connected");

        (pipe, client)
    }

    #[test]
    fn the_pipe_carries_the_acl_we_asked_for() {
        // The test this whole file exists for. `control_acl` proves the string
        // parses; this proves the string reached the kernel object. Between the
        // two sits `CreateNamedPipeW` silently ignoring the attributes, which
        // is a failure neither side would otherwise notice.
        //
        // **The readback is not the string we wrote, in two ways, and neither
        // is a fault.** We ask for `GA` (GENERIC_ALL) and the object carries
        // `FA` (FILE_ALL_ACCESS), because generic rights are mapped to the
        // target type's specific ones when the ACE is applied and a named pipe
        // is a file-system object. And a well-known SID returns under its SDDL
        // alias — the built-in Administrator as `LA` — which an ordinary
        // account never shows, so an exact comparison passes on a developer
        // machine and fails on a CI runner. Asserted as properties for that
        // reason, with the grantee normalised through Windows' own spelling.
        let pipe = ControlPipe::create(&unique_name()).expect("pipe created");
        let carried = pipe.dacl_sddl().expect("dacl readable");

        let us = crate::control_acl::as_windows_spells_it(
            &crate::control_acl::current_user_sid().expect("sid"),
        )
        .expect("spelling");

        assert!(carried.starts_with("D:P"), "not protected: {carried}");
        assert_eq!(
            carried.matches('(').count(),
            2,
            "unexpected ACEs: {carried}"
        );
        assert!(
            carried.contains("(D;;FA;;;NU)"),
            "network allowed: {carried}"
        );
        assert!(
            carried.contains(&format!("(A;;FA;;;{us})")),
            "wrong grantee: {carried}"
        );
    }

    #[test]
    fn the_owner_can_still_open_it() {
        // The opposite failure to the one above, and the easier one to ship: an
        // ACL so tight that the legitimate client is refused too.
        let (_pipe, _client) = connected();
    }

    #[test]
    fn a_pipe_nobody_created_cannot_be_opened() {
        // It must fail, and it must fail rather than wait: `connect` only waits
        // on ERROR_PIPE_BUSY, so a name with no listener behind it has to come
        // back promptly with something else.
        assert!(ControlClient::connect("anatria3d-no-listener-here").is_err());
    }

    #[test]
    fn a_second_client_is_refused_while_the_first_holds_the_pipe() {
        // `MAX_INSTANCES` is 1, which is what keeps two agents from fighting
        // over one viewport. Observed through `connect_now`, because `connect`
        // waits the condition away — right for a client, wrong for a test
        // trying to see it happen.
        let name = unique_name();
        let pipe = ControlPipe::create(&name).expect("pipe created");
        let joining = {
            let name = name.clone();
            std::thread::spawn(move || ControlClient::connect(&name))
        };
        pipe.wait_for_client().expect("client accepted");
        let _first = joining.join().expect("thread").expect("connected");

        assert!(
            matches!(
                ControlClient::connect_now(&name),
                Err(PipeError::Connect(231))
            ),
            "a second client got in while the first held the only instance"
        );
    }

    #[test]
    fn a_line_arrives_whole() {
        let (mut pipe, client) = connected();
        client
            .write_line(r#"{"action":"reset_view"}"#)
            .expect("written");
        let line = pipe.read_line().expect("read").expect("a line");
        assert_eq!(line, r#"{"action":"reset_view"}"#);
    }

    #[test]
    fn a_line_split_across_writes_is_reassembled() {
        // A byte-mode pipe delivers whatever arrived, which has no reason to
        // align with a newline. A reader that assumed one read is one line
        // would work in every test until a command grew.
        let (mut pipe, client) = connected();
        client.write_raw(br#"{"action":"res"#).expect("part one");
        client.write_raw(b"et_view\"}\n").expect("part two");
        let line = pipe.read_line().expect("read").expect("a line");
        assert_eq!(line, r#"{"action":"reset_view"}"#);
    }

    #[test]
    fn two_lines_in_one_write_stay_two_lines() {
        let (mut pipe, client) = connected();
        client.write_raw(b"first\nsecond\n").expect("written");
        assert_eq!(pipe.read_line().expect("read").as_deref(), Some("first"));
        assert_eq!(pipe.read_line().expect("read").as_deref(), Some("second"));
    }

    #[test]
    fn a_carriage_return_is_not_part_of_the_line() {
        let (mut pipe, client) = connected();
        client.write_raw(b"{}\r\n").expect("written");
        assert_eq!(pipe.read_line().expect("read").as_deref(), Some("{}"));
    }

    #[test]
    fn a_client_that_hangs_up_reads_as_the_end() {
        let (mut pipe, client) = connected();
        drop(client);
        assert!(pipe.read_line().expect("read").is_none());
    }

    #[test]
    fn a_client_that_never_sends_a_newline_is_refused() {
        // Without the cap this is a process growing a buffer until somebody
        // notices, which is the one denial-of-service a local pipe still
        // affords a badly written client.
        let (mut pipe, client) = connected();
        std::thread::spawn(move || {
            let filler = vec![b'x'; 8192];
            // Stops when the read side gives up and the pipe breaks.
            while client.write_raw(&filler).is_ok() {}
        });
        assert!(matches!(pipe.read_line(), Err(PipeError::LineTooLong)));
    }

    #[test]
    fn a_disconnect_drops_what_the_last_client_left_behind() {
        // A partial line from one client must not become the first half of the
        // next one's first command.
        let (mut pipe, client) = connected();
        client.write_raw(b"half a comm").expect("written");
        // Give it a moment to arrive, then take it into `pending` by reading
        // what is there — the read blocks, so instead assert the simpler
        // property: disconnect clears the buffer either way.
        drop(client);
        let _ = pipe.read_line();
        pipe.disconnect();
        assert!(pipe.pending.is_empty());
    }
}
