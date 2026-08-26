//! The access-control list for the control bridge's named pipe.
//!
//! Windows named pipes are the reason this file exists. A Unix socket is made
//! private by `chmod 0600` and one line; a named pipe created with a null
//! security descriptor is reachable by every process on the machine and, where
//! the host permits it, from another machine entirely. The default is wrong in
//! the unsafe direction, so the descriptor is written out here deliberately
//! rather than left to Windows to guess.
//!
//! **Nothing in the application calls this yet**, and that is the point of
//! landing it alone. The descriptor is the single most likely thing in the
//! bridge to be quietly wrong — quietly being the problem, because a pipe with
//! a permissive ACL behaves exactly like a correct one until somebody looks.
//!
//! `windows-sys` rather than a wrapper crate: it is already in the dependency
//! tree by way of Tauri, so this adds no new supply chain, and the ACL is the
//! part worth having written where it can be read.

#![cfg(windows)]
// Unreachable from the application on purpose — see the module note above. The
// tests are the only callers until the pipe lands, and `-D warnings` would
// otherwise refuse the build for it. This line comes off in the same commit
// that gives it a call site; if it is still here once the bridge exists,
// something was wired up wrong.
#![allow(dead_code)]

use std::ffi::c_void;
use std::fmt;
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenUser, DACL_SECURITY_INFORMATION, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// What went wrong reaching for the current user's identity.
///
/// Every variant carries the Win32 code, because "could not read the token"
/// without one is a sentence nobody can act on.
#[derive(Debug)]
pub enum AclError {
    Token(u32),
    Sid(u32),
    Descriptor(u32),
    Readback(u32),
}

impl fmt::Display for AclError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Token(code) => write!(f, "could not read this process's token (Win32 {code})"),
            Self::Sid(code) => write!(f, "could not read this user's SID (Win32 {code})"),
            Self::Descriptor(code) => {
                write!(f, "could not build the security descriptor (Win32 {code})")
            }
            Self::Readback(code) => write!(f, "could not read the descriptor back (Win32 {code})"),
        }
    }
}

impl std::error::Error for AclError {}

/// A null-terminated UTF-16 buffer, as every `…W` entry point wants.
fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Take a null-terminated UTF-16 string Windows allocated for us, and free it.
///
/// # Safety
/// `text` must be a null-terminated UTF-16 string returned by a Win32 call
/// that allocated it with `LocalAlloc`. This frees it, so it must not be used
/// again afterwards.
unsafe fn take_local_wide(text: *mut u16) -> String {
    let mut len = 0usize;
    while unsafe { *text.add(len) } != 0 {
        len += 1;
    }
    let owned = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
    unsafe { LocalFree(text as *mut c_void) };
    owned
}

/// The SID of the user this process runs as, in SDDL string form.
///
/// Read from the process token rather than from a username: a name is neither
/// unique nor what the kernel compares, and the SID is the only identity an
/// access check actually sees.
pub fn current_user_sid() -> Result<String, AclError> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle needing no close, and
    // `token` is a valid out-pointer for the duration of the call.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(AclError::Token(unsafe { GetLastError() }));
    }

    let found = read_token_sid(token);
    // SAFETY: `token` came from the successful `OpenProcessToken` above and is
    // not touched again after this.
    unsafe { CloseHandle(token) };
    found
}

fn read_token_sid(token: HANDLE) -> Result<String, AclError> {
    // Asked twice on purpose. A TOKEN_USER is a header followed by a
    // variable-length SID, so the first call is expected to fail with
    // ERROR_INSUFFICIENT_BUFFER and report the size it needs.
    let mut needed = 0u32;
    // SAFETY: a null buffer of length zero is the documented way to ask for the
    // required size.
    unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed) };
    if needed == 0 {
        return Err(AclError::Token(unsafe { GetLastError() }));
    }

    let mut buffer = vec![0u8; needed as usize];
    // SAFETY: `buffer` is exactly the length the call above asked for.
    if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err(AclError::Token(unsafe { GetLastError() }));
    }

    // SAFETY: on success the buffer holds a TOKEN_USER whose `User.Sid` points
    // into that same buffer, which is alive for the rest of this function.
    let sid = unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid };

    let mut text: *mut u16 = ptr::null_mut();
    // SAFETY: `sid` is valid while `buffer` lives, and it does.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
        return Err(AclError::Sid(unsafe { GetLastError() }));
    }
    // SAFETY: the call above allocated `text` with LocalAlloc on success.
    Ok(unsafe { take_local_wide(text) })
}

/// The SDDL for a pipe only this user, on this machine, may open.
///
/// Three deliberate parts, in the order a canonical DACL requires — deny
/// before allow:
///
/// - **`D:P`** — a DACL that is *protected*. Without `P` the pipe inherits
///   whatever the namespace hands down, which defeats the point of writing one
///   out by hand.
/// - **`(D;;GA;;;NU)`** — deny everything to network logon users. A named pipe
///   is reachable as `\\host\pipe\name` from another machine, and a domain
///   account's SID is the same SID whether it arrives locally or over SMB. The
///   identity check alone would therefore let the right user in from the wrong
///   place.
/// - **`(A;;GA;;;<sid>)`** — allow everything to exactly one SID: this
///   process's own user. Not a group, not `BA`, not `SY`.
pub fn owner_only_sddl() -> Result<String, AclError> {
    let sid = current_user_sid()?;
    Ok(format!("D:P(D;;GA;;;NU)(A;;GA;;;{sid})"))
}

/// How Windows spells a principal in SDDL, which is not always how we wrote it.
///
/// Windows substitutes well-known aliases for well-known SIDs on the way back
/// out: the built-in Administrator (`S-1-5-21-…-500`) is returned as `LA`, the
/// Administrators group as `BA`, and so on. An ordinary account has no alias
/// and round-trips unchanged — which is why comparing a readback against the
/// string we wrote passes on a developer machine and fails on a CI runner that
/// happens to be running as Administrator.
///
/// Rather than carrying a copy of Windows' alias table, this asks Windows: it
/// builds a one-ACE descriptor naming the SID, reads it back, and returns
/// whatever spelling came out. Comparisons then happen in the vocabulary the
/// readback uses, whichever machine it is.
pub fn as_windows_spells_it(sid: &str) -> Result<String, AclError> {
    let probe = SecurityAttributes::from_sddl(&format!("D:(A;;GA;;;{sid})"))?;
    let readback = probe.to_sddl()?;
    readback
        .rsplit_once(";;;")
        .and_then(|(_, tail)| tail.strip_suffix(')'))
        .map(str::to_owned)
        .ok_or(AclError::Readback(0))
}

/// A security descriptor, freed when it goes out of scope.
///
/// Wrapped rather than handed back raw so the `LocalFree` cannot be forgotten,
/// and so the `SECURITY_ATTRIBUTES` given to `CreateNamedPipeW` cannot outlive
/// the descriptor it points at.
pub struct SecurityAttributes {
    descriptor: *mut c_void,
    attributes: SECURITY_ATTRIBUTES,
}

impl SecurityAttributes {
    /// Build one from an SDDL string.
    pub fn from_sddl(sddl: &str) -> Result<Self, AclError> {
        let mut descriptor: *mut c_void = ptr::null_mut();
        let text = wide(sddl);
        // SAFETY: `text` is a null-terminated UTF-16 string that outlives the
        // call, and `descriptor` is a valid out-pointer.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(AclError::Descriptor(unsafe { GetLastError() }));
        }

        Ok(Self {
            attributes: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                // The pipe handle must not travel into a child process.
                // Nothing spawns one holding it today, and a handle that
                // cannot be inherited cannot start doing so by accident.
                bInheritHandle: 0,
            },
            descriptor,
        })
    }

    /// The current user only. What the bridge will actually use.
    pub fn owner_only() -> Result<Self, AclError> {
        Self::from_sddl(&owner_only_sddl()?)
    }

    /// The pointer `CreateNamedPipeW` takes.
    pub fn as_ptr(&self) -> *const SECURITY_ATTRIBUTES {
        &self.attributes
    }

    /// What Windows says this descriptor holds, back in SDDL form.
    ///
    /// The only assertion in the tests that means anything: whether the string
    /// we wrote parsed into the ACL we intended is a claim only the kernel can
    /// settle.
    pub fn to_sddl(&self) -> Result<String, AclError> {
        let mut text: *mut u16 = ptr::null_mut();
        // SAFETY: `self.descriptor` is valid for as long as `self` lives, and
        // `text` is a valid out-pointer.
        if unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                self.descriptor,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(AclError::Readback(unsafe { GetLastError() }));
        }
        // SAFETY: the call above allocated `text` with LocalAlloc on success.
        Ok(unsafe { take_local_wide(text) })
    }
}

impl Drop for SecurityAttributes {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            // SAFETY: allocated by
            // ConvertStringSecurityDescriptorToSecurityDescriptorW, freed
            // exactly once here, and nothing reads it afterwards.
            unsafe { LocalFree(self.descriptor) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_current_user_has_a_sid() {
        let sid = current_user_sid().expect("this process has a token");
        assert!(sid.starts_with("S-1-"), "not a SID: {sid}");
    }

    #[test]
    fn the_sddl_grants_one_identity_and_denies_the_network() {
        let sddl = owner_only_sddl().expect("sddl");
        let sid = current_user_sid().expect("sid");

        assert!(sddl.starts_with("D:P"), "DACL is not protected: {sddl}");
        assert!(
            sddl.contains("(D;;GA;;;NU)"),
            "network is not denied: {sddl}"
        );
        assert!(
            sddl.contains(&format!("(A;;GA;;;{sid})")),
            "wrong grantee: {sddl}"
        );
    }

    #[test]
    fn a_well_known_sid_comes_back_under_its_alias() {
        // The behaviour `as_windows_spells_it` exists for, pinned on a SID that
        // aliases on every Windows machine — so this covers the case a
        // developer account cannot reproduce and a CI runner found the hard
        // way.
        assert_eq!(
            as_windows_spells_it("S-1-5-32-544").expect("administrators"),
            "BA"
        );
        // And an identity with no alias is returned as it was given.
        let ours = current_user_sid().expect("sid");
        let spelled = as_windows_spells_it(&ours).expect("ours");
        assert!(spelled == ours || !spelled.starts_with("S-1-"));
    }

    #[test]
    fn windows_agrees_with_what_we_wrote() {
        // Asks the kernel to parse our string and hands back what it actually
        // built. Asserted as properties rather than as one string, because the
        // readback is written in Windows' vocabulary and not ours: a
        // well-known SID returns under its alias, so an exact comparison would
        // depend on which account the tests run as.
        let attributes = SecurityAttributes::owner_only().expect("descriptor");
        let carried = attributes.to_sddl().expect("readback");
        let us = as_windows_spells_it(&current_user_sid().expect("sid")).expect("spelling");

        assert!(carried.starts_with("D:P"), "not protected: {carried}");
        assert_eq!(
            carried.matches('(').count(),
            2,
            "unexpected ACEs: {carried}"
        );
        assert!(
            carried.contains("(D;;GA;;;NU)"),
            "network allowed: {carried}"
        );
        assert!(
            carried.contains(&format!("(A;;GA;;;{us})")),
            "wrong grantee: {carried}"
        );
    }

    #[test]
    fn the_handle_is_not_inheritable() {
        let attributes = SecurityAttributes::owner_only().expect("descriptor");
        // SAFETY: reading fields of a struct this test owns and keeps alive.
        let raw = unsafe { &*attributes.as_ptr() };
        assert_eq!(raw.bInheritHandle, 0);
        assert!(!raw.lpSecurityDescriptor.is_null());
    }

    #[test]
    fn a_malformed_sddl_is_an_error_and_not_a_default_pipe() {
        // The failure that matters. Returning a null descriptor rather than an
        // error would have the caller create a pipe with default security and
        // never learn that it had.
        let refused = SecurityAttributes::from_sddl("this is not an SDDL string");
        assert!(matches!(refused, Err(AclError::Descriptor(_))));
    }
}
