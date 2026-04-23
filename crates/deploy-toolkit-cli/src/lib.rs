//! Binary-side helper: one function every Nimblesite binary can call from
//! `fn main()` to implement the deploy-toolkit `--version` contract.
//!
//! Plain form (single grep-friendly line):
//! ```text
//! <name> <semver>
//! ```
//! JSON form (schema-bound to `schemas/version-manifest.schema.json`):
//! ```text
//! <binary> --version --json
//! ```
//!
//! See `build_info.rs.example` for the recommended `build.rs` that emits
//! `GIT_SHA` and `BUILD_TIME` as compile-time env vars.

#![forbid(unsafe_code)]

use deploy_toolkit_manifest::{ExecutableKind, Language, ManifestError, VersionOutput};
use std::io::Write;

/// Error from the CLI helpers: either an I/O failure writing to stdout, or a
/// manifest validation/serialization failure.
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    /// Underlying writer returned an error.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// Manifest validation or JSON serialization failed.
    #[error("manifest: {0}")]
    Manifest(#[from] ManifestError),
}

/// Compile-time build metadata produced by a downstream crate's `build.rs`.
#[derive(Debug, Clone, Copy)]
pub struct BuildInfo<'a> {
    /// Short git sha, e.g. `7a9b3e1`.
    pub git_sha: Option<&'a str>,
    /// `true` when the working tree had uncommitted changes at build time.
    pub git_dirty: Option<bool>,
    /// RFC3339 UTC timestamp of the build.
    pub build_time: Option<&'a str>,
    /// Rust target triple or other runtime identifier.
    pub target: Option<&'a str>,
    /// Toolchain string, e.g. `rustc 1.84.0`.
    pub toolchain: Option<&'a str>,
}

/// How the binary was invoked with respect to the `--version` contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionMode {
    /// Caller passed neither `--version` nor `--version --json`.
    NotRequested,
    /// `--version` alone: emit a single line.
    Plain,
    /// `--version --json` (in any order): emit the JSON form.
    Json,
}

impl VersionMode {
    /// Parse the requested mode from an argv slice (typically `std::env::args()`).
    pub fn from_args<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut has_version = false;
        let mut has_json = false;
        for a in args {
            match a.as_ref() {
                "--version" | "-V" => has_version = true,
                "--json" => has_json = true,
                _ => {}
            }
        }
        match (has_version, has_json) {
            (true, true) => Self::Json,
            (true, false) => Self::Plain,
            _ => Self::NotRequested,
        }
    }
}

/// Write the plain `--version` line.
///
/// # Errors
/// Returns any I/O error from the writer.
pub fn write_plain<W: Write>(mut w: W, name: &str, version: &str) -> std::io::Result<()> {
    writeln!(w, "{name} {version}")
}

/// Declarative spec of what a binary should report. Keeps per-call argument
/// counts small enough for `clippy::too_many_arguments`.
#[derive(Debug, Clone)]
pub struct VersionSpec<'a> {
    /// Binary name (argv[0], no `.exe`).
    pub name: &'a str,
    /// Semver.
    pub version: &'a str,
    /// What this binary is.
    pub kind: ExecutableKind,
    /// Which language runtime it uses.
    pub language: Language,
    /// Product id (the owning product's manifest `product.id`).
    pub product: Option<&'a str>,
    /// Declared capabilities (LSP features, transports, etc.).
    pub capabilities: &'a [&'a str],
    /// Build-time metadata from `build.rs`.
    pub build: BuildInfo<'a>,
}

/// Write the `--version --json` payload to `w`.
///
/// # Errors
/// Returns [`CliError::Manifest`] if validation or serialization fails, or
/// [`CliError::Io`] from the writer.
pub fn write_json<W: Write>(mut w: W, spec: &VersionSpec<'_>) -> Result<(), CliError> {
    let mut out = VersionOutput::new(
        spec.name,
        spec.version,
        spec.kind.clone(),
        spec.language.clone(),
    )?;
    if let Some(sha) = spec.build.git_sha {
        out.git_sha = Some(sha.to_string());
    }
    if let Some(dirty) = spec.build.git_dirty {
        out.git_dirty = Some(dirty);
    }
    if let Some(t) = spec.build.build_time {
        out.build_time = Some(t.to_string());
    }
    if let Some(t) = spec.build.target {
        out.target = Some(t.to_string());
    }
    if let Some(t) = spec.build.toolchain {
        out.toolchain = Some(t.to_string());
    }
    out.capabilities = spec
        .capabilities
        .iter()
        .copied()
        .map(str::to_string)
        .collect();
    if let Some(p) = spec.product {
        out.product = Some(p.to_string());
    }
    serde_json::to_writer(&mut w, &out).map_err(ManifestError::from)?;
    writeln!(w)?;
    Ok(())
}

/// One-call dispatcher used by thin `fn main()` bodies.
///
/// Returns `true` when a version flag was handled and the caller should
/// terminate with exit-code `0`; `false` means the binary should continue
/// normal execution.
///
/// # Errors
/// Propagates [`CliError`] from the JSON or plain path.
pub fn dispatch<I, S, W>(args: I, out: W, spec: &VersionSpec<'_>) -> Result<bool, CliError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    W: Write,
{
    match VersionMode::from_args(args) {
        VersionMode::NotRequested => Ok(false),
        VersionMode::Plain => {
            write_plain(out, spec.name, spec.version)?;
            Ok(true)
        }
        VersionMode::Json => {
            write_json(out, spec)?;
            Ok(true)
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::{write_json, write_plain, BuildInfo, VersionMode, VersionSpec};
    use deploy_toolkit_manifest::{ExecutableKind, Language};

    #[test]
    fn plain_matches_contract() {
        let mut buf: Vec<u8> = Vec::new();
        write_plain(&mut buf, "deslop-lsp", "0.4.2").expect("write");
        assert_eq!(buf, b"deslop-lsp 0.4.2\n");
    }

    #[test]
    fn json_conforms() {
        let mut buf: Vec<u8> = Vec::new();
        write_json(
            &mut buf,
            &VersionSpec {
                name: "deslop-lsp",
                version: "0.4.2",
                kind: ExecutableKind::Lsp,
                language: Language::Rust,
                product: Some("deslop"),
                capabilities: &["lsp", "stdio"],
                build: BuildInfo {
                    git_sha: Some("7a9b3e1"),
                    git_dirty: Some(false),
                    build_time: Some("2026-04-22T10:14:55Z"),
                    target: Some("aarch64-apple-darwin"),
                    toolchain: Some("rustc 1.84.0"),
                },
            },
        )
        .expect("write json");
        let s = std::str::from_utf8(&buf).expect("utf8");
        assert!(s.contains("\"name\":\"deslop-lsp\""), "name: {s}");
        assert!(s.contains("\"version\":\"0.4.2\""), "version: {s}");
        assert!(s.contains("\"kind\":\"lsp\""), "kind: {s}");
        assert!(s.contains("\"language\":\"rust\""), "language: {s}");
        assert!(s.contains("\"manifestVersion\":1"), "mv: {s}");
        assert!(s.ends_with('\n'));
    }

    #[test]
    fn mode_parsing() {
        assert_eq!(
            VersionMode::from_args(["prog"].iter().copied()),
            VersionMode::NotRequested
        );
        assert_eq!(
            VersionMode::from_args(["prog", "--version"].iter().copied()),
            VersionMode::Plain
        );
        assert_eq!(
            VersionMode::from_args(["prog", "--version", "--json"].iter().copied()),
            VersionMode::Json
        );
        assert_eq!(
            VersionMode::from_args(["prog", "--json", "--version"].iter().copied()),
            VersionMode::Json
        );
    }
}
