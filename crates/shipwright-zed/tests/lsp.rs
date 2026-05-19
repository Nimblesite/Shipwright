//! Tests for Zed-specific deferred LSP helpers.

#![allow(
    clippy::expect_used,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used
)]

use shipwright_zed::{
    deferred_lsp_resolution, verify_lsp_server_info, DeferredCheck, ErrorCode, LspServerInfo,
    Resolution, Source, Status,
};

fn assert_no_error_fields(resolution: &Resolution) {
    assert_eq!(resolution.warning_code, None);
    assert_eq!(resolution.error_code, None);
    assert_eq!(resolution.error_details, None);
    assert_eq!(resolution.action, None);
}

fn assert_error_without_result_fields(resolution: &Resolution, code: ErrorCode) {
    assert_eq!(resolution.status, Status::Error);
    assert_eq!(resolution.source, None);
    assert_eq!(resolution.path, None);
    assert_eq!(resolution.version, None);
    assert_eq!(resolution.warning_code, None);
    assert_eq!(resolution.error_code, Some(code));
    assert_eq!(resolution.action, None);
    assert_eq!(resolution.deferred_check, None);
}

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
    assert_eq!(resolution.version, None);
    assert_no_error_fields(&resolution);
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
    assert_eq!(resolution.source, Some(Source::LspInitialize));
    assert_eq!(resolution.path.as_deref(), Some("deslop-lsp"));
    assert_eq!(resolution.version.as_deref(), Some("0.1.0"));
    assert_eq!(resolution.deferred_check, None);
    assert_no_error_fields(&resolution);
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

    assert_error_without_result_fields(&resolution, ErrorCode::BinaryNameMismatch);
    assert_eq!(resolution.error_details, None);
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

    assert_error_without_result_fields(&resolution, ErrorCode::NoSourceResolved);

    let details = resolution
        .error_details
        .expect("version drift should include mismatch details");
    assert_eq!(details.expected, "0.1.0");
    assert_eq!(details.found, "0.0.9");
    assert_eq!(details.at, "deslop-lsp");
}

#[test]
fn lsp_server_info_rejects_missing_server_info() {
    let resolution = verify_lsp_server_info("deslop-lsp", "0.1.0", None);

    assert_error_without_result_fields(&resolution, ErrorCode::NoSourceResolved);

    let details = resolution
        .error_details
        .expect("missing serverInfo should include mismatch details");
    assert_eq!(details.expected, "0.1.0");
    assert_eq!(details.found, "");
    assert_eq!(details.at, "deslop-lsp");
}
