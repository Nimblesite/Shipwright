//! Public API integration tests for the binary-side version helpers.

use serde_json::Value;
use shipwright::{
    dispatch, write_json, write_plain, BuildInfo, CliError, VersionMode, VersionSpec,
};
use shipwright_manifest::{ExecutableKind, Language, ManifestError};
use std::error::Error;
use std::io::{Error as IoError, ErrorKind, Write};

/// Capabilities used by the full metadata fixture.
const FULL_CAPABILITIES: &[&str] = &["lsp", "stdio"];

/// Writer that rejects every write call.
#[derive(Debug)]
struct AlwaysFailWriter;

impl Write for AlwaysFailWriter {
    /// Return a deterministic broken-pipe error for write attempts.
    fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
        Err(IoError::new(ErrorKind::BrokenPipe, "closed"))
    }

    /// Succeed so tests can cover the required trait method.
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Writer that accepts JSON bytes but rejects the final newline.
#[derive(Debug, Default)]
struct NewlineFailWriter {
    /// Bytes accepted before the newline failure.
    bytes: Vec<u8>,
}

impl Write for NewlineFailWriter {
    /// Record non-newline bytes and reject a standalone newline.
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if buf == b"\n" {
            return Err(IoError::new(ErrorKind::BrokenPipe, "newline rejected"));
        }
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }

    /// Succeed so tests can cover the required trait method.
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Build a minimal valid version spec.
fn minimal_spec() -> VersionSpec<'static> {
    VersionSpec {
        name: "deslop-lsp",
        version: "0.4.2",
        kind: ExecutableKind::Lsp,
        language: Language::Rust,
        product: None,
        capabilities: &[],
        build: BuildInfo {
            git_sha: None,
            git_dirty: None,
            build_time: None,
            target: None,
            toolchain: None,
        },
    }
}

/// Build a version spec with every optional metadata field populated.
fn full_spec() -> VersionSpec<'static> {
    VersionSpec {
        name: "deslop-lsp",
        version: "0.4.2",
        kind: ExecutableKind::Lsp,
        language: Language::Rust,
        product: Some("deslop"),
        capabilities: FULL_CAPABILITIES,
        build: BuildInfo {
            git_sha: Some("7a9b3e1"),
            git_dirty: Some(false),
            build_time: Some("2026-04-22T10:14:55Z"),
            target: Some("aarch64-apple-darwin"),
            toolchain: Some("rustc 1.84.0"),
        },
    }
}

/// Build an invalid spec that fails manifest validation.
fn invalid_spec() -> VersionSpec<'static> {
    VersionSpec {
        name: "Deslop",
        ..minimal_spec()
    }
}

/// Convert compact test literals into owned argv values.
fn args(values: &[&str]) -> Vec<String> {
    values.iter().copied().map(str::to_string).collect()
}

/// Parse a JSON payload emitted by the public helpers.
fn parse_payload(buf: &[u8]) -> Result<Value, serde_json::Error> {
    serde_json::from_slice(buf)
}

/// Version mode parsing treats JSON as a modifier for the version flag.
#[test]
fn version_mode_parses_public_flags() {
    assert_eq!(
        VersionMode::from_args(&args(&["prog"])),
        VersionMode::NotRequested
    );
    assert_eq!(
        VersionMode::from_args(&args(&["prog", "-V"])),
        VersionMode::Plain
    );
    assert_eq!(
        VersionMode::from_args(&args(&["prog", "--json", "--version"])),
        VersionMode::Json,
    );
    assert_eq!(
        VersionMode::from_args(&args(&["prog", "--json"])),
        VersionMode::NotRequested,
    );
}

/// Dispatch returns false and preserves the writer when no version flag is present.
#[test]
fn dispatch_false_path_leaves_output_empty() -> Result<(), CliError> {
    let mut out = Vec::new();
    let handled = dispatch(&args(&["prog", "serve"]), &mut out, &minimal_spec())?;

    assert!(!handled);
    assert!(out.is_empty());
    Ok(())
}

/// The direct plain writer emits the grep-friendly contract line.
#[test]
fn write_plain_public_api_matches_contract() -> Result<(), std::io::Error> {
    let mut out = Vec::new();
    write_plain(&mut out, "deslop-lsp", "0.4.2")?;

    assert_eq!(out, b"deslop-lsp 0.4.2\n");
    Ok(())
}

/// Dispatch handles the plain version request and asks the caller to exit.
#[test]
fn dispatch_plain_path_writes_version_line() -> Result<(), CliError> {
    let mut out = Vec::new();
    let handled = dispatch(&args(&["prog", "--version"]), &mut out, &minimal_spec())?;

    assert!(handled);
    assert_eq!(out, b"deslop-lsp 0.4.2\n");
    Ok(())
}

/// Dispatch handles JSON requests and emits the compact schema payload.
#[test]
fn dispatch_json_path_writes_version_payload() -> Result<(), Box<dyn Error>> {
    let mut out = Vec::new();
    let handled = dispatch(
        &args(&["prog", "--version", "--json"]),
        &mut out,
        &full_spec(),
    )?;
    let parsed = parse_payload(&out)?;

    assert!(handled);
    assert_eq!(parsed.get("manifestVersion"), Some(&Value::from(1u32)));
    assert_eq!(parsed.get("product"), Some(&Value::from("deslop")));
    assert_eq!(
        parsed
            .get("capabilities")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(2)
    );
    Ok(())
}

/// Minimal JSON metadata omits every optional field.
#[test]
fn write_json_minimal_metadata_omits_optional_fields() -> Result<(), Box<dyn Error>> {
    let mut out = Vec::new();
    write_json(&mut out, &minimal_spec())?;
    let parsed = parse_payload(&out)?;

    assert_eq!(parsed.get("name"), Some(&Value::from("deslop-lsp")));
    assert!(parsed.get("buildTime").is_none());
    assert!(parsed.get("gitSha").is_none());
    assert!(parsed.get("product").is_none());
    assert!(parsed.get("capabilities").is_none());
    Ok(())
}

/// Full JSON metadata preserves every optional field.
#[test]
fn write_json_full_metadata_preserves_all_fields() -> Result<(), Box<dyn Error>> {
    let mut out = Vec::new();
    write_json(&mut out, &full_spec())?;
    let parsed = parse_payload(&out)?;

    assert_eq!(parsed.get("gitSha"), Some(&Value::from("7a9b3e1")));
    assert_eq!(parsed.get("gitDirty"), Some(&Value::from(false)));
    assert_eq!(
        parsed.get("buildTime"),
        Some(&Value::from("2026-04-22T10:14:55Z"))
    );
    assert_eq!(
        parsed.get("target"),
        Some(&Value::from("aarch64-apple-darwin"))
    );
    assert_eq!(parsed.get("toolchain"), Some(&Value::from("rustc 1.84.0")));
    Ok(())
}

/// Dispatch maps plain writer failures to the `CliError::Io` variant.
#[test]
fn dispatch_plain_error_uses_cli_io_variant() {
    let mut writer = AlwaysFailWriter;
    assert!(writer.flush().is_ok());

    let result = dispatch(&args(&["prog", "--version"]), &mut writer, &minimal_spec());

    assert!(matches!(result, Err(CliError::Io(_))));
}

/// Dispatch maps invalid JSON version specs to the `CliError::Manifest` variant.
#[test]
fn dispatch_json_error_uses_cli_manifest_variant() {
    let mut out = Vec::new();
    let result = dispatch(
        &args(&["prog", "--version", "--json"]),
        &mut out,
        &invalid_spec(),
    );

    assert!(matches!(result, Err(CliError::Manifest(_))));
}

/// `write_json` maps final newline writer failures to the `CliError::Io` variant.
#[test]
fn write_json_newline_error_uses_cli_io_variant() {
    let mut writer = NewlineFailWriter::default();
    assert!(writer.flush().is_ok());

    let result = write_json(&mut writer, &minimal_spec());

    assert!(matches!(result, Err(CliError::Io(_))));
}

/// `write_json` maps JSON body writer failures through the manifest error path.
#[test]
fn write_json_body_error_uses_cli_manifest_variant() {
    let mut writer = AlwaysFailWriter;
    let result = write_json(&mut writer, &minimal_spec());

    assert!(matches!(result, Err(CliError::Manifest(_))));
}

/// Mutable writer references are accepted by every writer entry point.
#[test]
fn mutable_writer_references_are_supported() -> Result<(), Box<dyn Error>> {
    let mut plain = Vec::new();
    let mut json = Vec::new();
    let mut dispatch_plain = Vec::new();
    let mut dispatch_json = Vec::new();

    write_plain(&mut plain, "deslop-lsp", "0.4.2")?;
    write_json(&mut json, &full_spec())?;

    let plain_handled = dispatch(
        &args(&["prog", "--version"]),
        &mut dispatch_plain,
        &minimal_spec(),
    )?;
    let json_handled = dispatch(
        &args(&["prog", "--version", "--json"]),
        &mut dispatch_json,
        &full_spec(),
    )?;

    assert!(plain_handled);
    assert!(json_handled);
    Ok(())
}

/// Public error variants expose useful debug, display, and source behavior.
#[test]
fn cli_error_variants_format_and_chain_sources() {
    let io = CliError::Io(IoError::new(ErrorKind::BrokenPipe, "closed"));
    let manifest = CliError::Manifest(ManifestError::InvalidVersion("bad".to_string()));

    assert_eq!(io.to_string(), "io: closed");
    assert_eq!(manifest.to_string(), "manifest: invalid semver `bad`");
    assert!(format!("{io:?}").contains("Io"));
    assert!(Error::source(&io).is_some());
    assert!(Error::source(&manifest).is_some());
}

/// Public structs and enums expose their advertised clone/copy/debug traits.
#[test]
fn public_types_expose_expected_traits() {
    let spec = full_spec();
    let cloned = spec.clone();
    let build = cloned.build;
    let mode = VersionMode::Json;

    assert_eq!(cloned.name, "deslop-lsp");
    assert_eq!(build.git_dirty, Some(false));
    assert_eq!(mode, mode.clone());
    assert!(format!("{cloned:?}").contains("deslop-lsp"));
}
