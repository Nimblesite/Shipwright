//! Zed-facing helpers for shipwright host integrations.
//!
//! Zed extensions often cannot run native `--version` probes before the
//! language server starts. This crate re-exports the pure host resolver and
//! adds small helpers for representing deferred LSP checks and validating the
//! `serverInfo` payload returned from LSP `initialize`.
//!
//! Implements the Zed deployment contract SWR-IDE-ZED: digest-verified
//! `github-release` resolution and LSP-`initialize` version checks.

#![forbid(unsafe_code)]

pub use shipwright_host::{
    resolve, DeferredCheck, DotnetToolConfig, EnvConfig, ErrorCode, ErrorDetails, PkgmgrConfig,
    Platform, ProbedVersion, PromptAction, Resolution, ResolveInput, Source, Status, WarningCode,
};

/// The `serverInfo` subset Zed can verify from an LSP initialize response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LspServerInfo<'a> {
    /// Server name returned by `InitializeResult.serverInfo.name`.
    pub name: &'a str,
    /// Server version returned by `InitializeResult.serverInfo.version`.
    pub version: &'a str,
}

/// Build a deferred LSP version-check result for a resolved command path.
#[must_use]
pub fn deferred_lsp_resolution(source: Source, command_path: impl Into<String>) -> Resolution {
    Resolution::deferred(source, command_path.into(), DeferredCheck::LspInitialize)
}

/// Verify LSP `serverInfo` against the manifest component id and version.
#[must_use]
pub fn verify_lsp_server_info(
    component_id: &str,
    expected_version: &str,
    server_info: Option<LspServerInfo<'_>>,
) -> Resolution {
    match server_info {
        Some(info) if info.name != component_id => {
            Resolution::error(ErrorCode::BinaryNameMismatch, None)
        }
        Some(info) if info.version == expected_version => Resolution::ok(
            Source::LspInitialize,
            component_id.to_string(),
            info.version.to_string(),
        ),
        Some(info) => Resolution::error(
            ErrorCode::NoSourceResolved,
            Some(ErrorDetails {
                expected: expected_version.to_string(),
                found: info.version.to_string(),
                at: component_id.to_string(),
            }),
        ),
        None => Resolution::error(
            ErrorCode::NoSourceResolved,
            Some(ErrorDetails {
                expected: expected_version.to_string(),
                found: String::new(),
                at: component_id.to_string(),
            }),
        ),
    }
}
