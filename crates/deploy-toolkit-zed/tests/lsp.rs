//! Tests for Zed-specific deferred LSP helpers.

#![allow(
    clippy::expect_used,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used
)]

use deploy_toolkit_zed::{
    deferred_lsp_resolution, verify_lsp_server_info, DeferredCheck, ErrorCode, LspServerInfo,
    Source, Status,
};

#[test]
fn deferred_lsp_resolution_uses_lsp_initialize_check() {
    let resolution = deferred_lsp_resolution(Source::GithubRelease, "/cache/deslop-lsp");

    assert_eq!(resolution.status, Status::Deferred);
    assert_eq!(resolution.source, Some(Source::GithubRelease));
    assert_eq!(resolution.path.as_deref(), Some("/cache/deslop-lsp"));
    assert_eq!(
        resolution.deferred_check,
        Some(DeferredCheck::LspInitialize)
    );
}

#[test]
fn lsp_server_info_matches_component_and_version() {
    let resolution = verify_lsp_server_info(
        "deslop-lsp",
        "0.1.0",
        Some(LspServerInfo {
            name: "deslop-lsp",
            version: "0.1.0",
        }),
    );

    assert_eq!(resolution.status, Status::Ok);
    assert_eq!(resolution.version.as_deref(), Some("0.1.0"));
}

#[test]
fn lsp_server_info_rejects_name_drift() {
    let resolution = verify_lsp_server_info(
        "deslop-lsp",
        "0.1.0",
        Some(LspServerInfo {
            name: "other-lsp",
            version: "0.1.0",
        }),
    );

    assert_eq!(resolution.status, Status::Error);
    assert_eq!(resolution.error_code, Some(ErrorCode::BinaryNameMismatch));
}

#[test]
fn lsp_server_info_rejects_version_drift() {
    let resolution = verify_lsp_server_info(
        "deslop-lsp",
        "0.1.0",
        Some(LspServerInfo {
            name: "deslop-lsp",
            version: "0.0.9",
        }),
    );

    assert_eq!(resolution.status, Status::Error);
    assert_eq!(resolution.error_code, Some(ErrorCode::NoSourceResolved));
    assert_eq!(
        resolution.error_details.expect("details").found.as_str(),
        "0.0.9"
    );
}
