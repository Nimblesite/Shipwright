//! Binary-resolution algorithm for deployment-toolkit host libraries.
//!
//! Pure function. No I/O. The caller supplies a `probe` closure
//! (`Path -> Option<ProbedVersion>`), the environment, PATH entries, the
//! bundled directory, and the product's declared sources. The resolver
//! returns a [`Resolution`] describing which source succeeded, where, which
//! version was observed, and a status (ok / ok-with-warning / deferred /
//! prompt / error).
//!
//! Conformance: the vectors in `schemas/test-vectors.json` are exercised by
//! `tests/conformance.rs`. Every language port of this algorithm must pass
//! the same vectors bit-for-bit.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Ordered discovery sources declared in `deployment-toolkit.schema.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    /// Explicit path from an IDE settings key; accepted only on exact match.
    UserSetting,
    /// `<TOOL>_BINARY_PATH` or `<TOOL>_BINARY_DIR`; accepted unconditionally.
    Env,
    /// PATH scan; accepted only on exact match.
    Path,
    /// Bundled inside the IDE extension; accepted unconditionally.
    Bundled,
    /// Native package manager (brew/scoop/apt/winget); surfaces as a prompt.
    Pkgmgr,
    /// `dotnet tool` global install; surfaces install/update prompts.
    DotnetTool,
    /// `npm`-installed bin on PATH.
    NpmGlobal,
    /// `~/.cargo/bin` fallback (Basilisk-style).
    CargoBin,
    /// Download from a GitHub Release (Basilisk-style, opt-in per tool).
    GithubRelease,
    /// Defer version check to LSP `initialize` response (Zed fallback).
    LspInitialize,
}

/// Probe result: what `<binary> --version` reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProbedVersion {
    /// The `name` token emitted by the binary.
    pub name: String,
    /// The `semver` token emitted by the binary.
    pub version: String,
}

/// Env-var names this component consults.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnvConfig {
    /// Absolute-file override, e.g. `DESLOP_BINARY_PATH`.
    #[serde(rename = "pathVar", skip_serializing_if = "Option::is_none")]
    pub path_var: Option<String>,
    /// Directory override, e.g. `DESLOP_BINARY_DIR`.
    #[serde(rename = "dirVar", skip_serializing_if = "Option::is_none")]
    pub dir_var: Option<String>,
}

/// Package-manager install targets for the `pkgmgr` source.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PkgmgrConfig {
    /// Homebrew formula identifier (e.g. `example/tap/forge-lsp`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brew: Option<String>,
    /// Scoop manifest identifier (e.g. `example/forge-lsp`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scoop: Option<String>,
    /// `apt` package identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apt: Option<String>,
    /// `winget` package identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winget: Option<String>,
}

/// `dotnet tool` metadata for the `dotnet-tool` source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DotnetToolConfig {
    /// `NuGet` package id (e.g. `Forge.Sidecar.CSharp`).
    pub package: String,
    /// Shim command name (defaults to `package`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

/// Runtime inputs for a single resolve call.
#[derive(Debug, Clone)]
pub struct ResolveInput<'a> {
    /// Binary name (argv[0]), without `.exe`.
    pub binary_name: &'a str,
    /// Name the binary must self-report; defaults to `binary_name`.
    pub expected_name: Option<&'a str>,
    /// Required semver.
    pub expected_version: &'a str,
    /// Declared discovery chain (filter on the full `Source` enum).
    pub sources: &'a [Source],
    /// Current platform (controls `.exe` suffix + pkgmgr command fan-out).
    pub platform: Platform,

    /// Path from the IDE settings key, if any.
    pub user_setting_path: Option<&'a str>,
    /// Env map probed via `EnvConfig.path_var` / `dir_var`.
    pub env: &'a HashMap<String, String>,
    /// Which env vars to read.
    pub env_config: EnvConfig,
    /// Expanded PATH entries (not raw `$PATH`; caller already split).
    pub path_entries: &'a [String],
    /// Bundled `<extensionRoot>/bin/<platform>` directory.
    pub bundled_dir: Option<&'a str>,
    /// Cargo bin location for Zed-style `cargo-bin` fallback.
    pub cargo_bin: Option<&'a str>,

    /// Optional pkgmgr policy.
    pub pkgmgr: Option<&'a PkgmgrConfig>,
    /// Optional dotnet-tool policy.
    pub dotnet_tool: Option<&'a DotnetToolConfig>,
}

/// Canonical platform identifiers. Mirrors `schemas/platforms.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    /// macOS Apple Silicon.
    DarwinArm64,
    /// macOS Intel.
    DarwinX64,
    /// Linux `x86_64`.
    LinuxX64,
    /// Linux `aarch64`.
    LinuxArm64,
    /// Windows `x86_64`.
    Win32X64,
    /// Windows `aarch64`.
    Win32Arm64,
    /// Platform-agnostic (Node, dotnet tool, jar, Zed WASM).
    All,
}

impl Platform {
    /// Returns `.exe` on Windows, empty string elsewhere.
    #[must_use]
    pub fn exe_suffix(self) -> &'static str {
        if matches!(self, Self::Win32X64 | Self::Win32Arm64) {
            ".exe"
        } else {
            ""
        }
    }
}

/// High-level outcome category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// Resolved and version matches.
    Ok,
    /// Resolved but with a warning (e.g. bundled drift, env override).
    OkWithWarning,
    /// Resolved; version check deferred (Zed LSP initialize).
    Deferred,
    /// Host must prompt the user (install / update).
    Prompt,
    /// Cannot resolve.
    Error,
}

/// Known warning codes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WarningCode {
    /// Env-override binary version differs from expected.
    EnvVersionMismatch,
    /// Bundled binary version differs from expected.
    BundledVersionDrift,
}

/// Known error codes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    /// User-setting path exists but version differs from expected.
    UserSettingVersionMismatch,
    /// No declared source produced a candidate.
    NoSourceResolved,
    /// A candidate binary self-reports the wrong name.
    BinaryNameMismatch,
}

/// Deferred check kinds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeferredCheck {
    /// Version will be verified via LSP `initialize` response.
    LspInitialize,
}

/// Actionable prompt payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum PromptAction {
    /// Show platform-specific install commands.
    PkgmgrInstall {
        /// Map of `platform-id -> install command`.
        commands: HashMap<String, String>,
    },
    /// Run a single `dotnet tool` install/update command.
    DotnetToolUpdate {
        /// The command to run.
        command: String,
    },
}

/// Expected-vs-found details for a mismatch error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorDetails {
    /// The required version from the product manifest.
    pub expected: String,
    /// What the binary reported.
    pub found: String,
    /// The path probed.
    pub at: String,
}

/// Final output of [`resolve`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resolution {
    /// Which source produced the result, if any.
    pub source: Option<Source>,
    /// The resolved path, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The version observed, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Outcome category.
    pub status: Status,
    /// Warning code when `status == OkWithWarning`.
    #[serde(rename = "warningCode", skip_serializing_if = "Option::is_none")]
    pub warning_code: Option<WarningCode>,
    /// Error code when `status == Error`.
    #[serde(rename = "errorCode", skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ErrorCode>,
    /// Mismatch details when available.
    #[serde(rename = "errorDetails", skip_serializing_if = "Option::is_none")]
    pub error_details: Option<ErrorDetails>,
    /// Action to show when `status == Prompt`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<PromptAction>,
    /// Which deferred check the host must run when `status == Deferred`.
    #[serde(rename = "deferredCheck", skip_serializing_if = "Option::is_none")]
    pub deferred_check: Option<DeferredCheck>,
}

impl Resolution {
    /// Construct an `Ok` result.
    #[must_use]
    pub fn ok(source: Source, path: String, version: String) -> Self {
        Self {
            source: Some(source),
            path: Some(path),
            version: Some(version),
            status: Status::Ok,
            warning_code: None,
            error_code: None,
            error_details: None,
            action: None,
            deferred_check: None,
        }
    }
    /// Construct an `OkWithWarning` result.
    #[must_use]
    pub fn ok_warn(source: Source, path: String, version: String, code: WarningCode) -> Self {
        let mut r = Self::ok(source, path, version);
        r.status = Status::OkWithWarning;
        r.warning_code = Some(code);
        r
    }
    /// Construct an `Error` result.
    #[must_use]
    pub fn error(code: ErrorCode, details: Option<ErrorDetails>) -> Self {
        Self {
            source: None,
            path: None,
            version: None,
            status: Status::Error,
            warning_code: None,
            error_code: Some(code),
            error_details: details,
            action: None,
            deferred_check: None,
        }
    }
    /// Construct a `Prompt` result.
    #[must_use]
    pub fn prompt(action: PromptAction) -> Self {
        Self {
            source: None,
            path: None,
            version: None,
            status: Status::Prompt,
            warning_code: None,
            error_code: None,
            error_details: None,
            action: Some(action),
            deferred_check: None,
        }
    }
    /// Construct a `Deferred` result.
    #[must_use]
    pub fn deferred(source: Source, path: String, check: DeferredCheck) -> Self {
        Self {
            source: Some(source),
            path: Some(path),
            version: None,
            status: Status::Deferred,
            warning_code: None,
            error_code: None,
            error_details: None,
            action: None,
            deferred_check: Some(check),
        }
    }
}

/// The single entry point. Every host library (TS, Kotlin, C#, Dart, Zed)
/// ports this function and passes `schemas/test-vectors.json` bit-for-bit.
pub fn resolve<F>(input: &ResolveInput<'_>, mut probe: F) -> Resolution
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    for source in input.sources {
        if let Some(r) = try_source(*source, input, &mut probe) {
            return r;
        }
    }
    Resolution::error(ErrorCode::NoSourceResolved, None)
}

/// Dispatch a single source to its handler. Returns `None` when the source
/// produced no candidate and the resolver should fall through to the next.
fn try_source<F>(source: Source, input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    match source {
        Source::UserSetting => try_user_setting(input, probe),
        Source::Env => try_env(input, probe),
        Source::Path => try_path(input, probe),
        Source::Bundled => try_bundled(input, probe),
        Source::CargoBin => try_cargo_bin(input),
        Source::Pkgmgr => try_pkgmgr(input),
        Source::DotnetTool => try_dotnet_tool(input, probe),
        Source::NpmGlobal | Source::GithubRelease | Source::LspInitialize => None,
    }
}

/// Handle the `user-setting` source. Mismatch is a hard error.
fn try_user_setting<F>(input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    let path = input.user_setting_path?;
    match probe(path) {
        Some(got) if !name_matches(input, &got) => {
            Some(Resolution::error(ErrorCode::BinaryNameMismatch, None))
        }
        Some(got) if got.version == input.expected_version => Some(Resolution::ok(
            Source::UserSetting,
            path.to_string(),
            got.version,
        )),
        Some(got) => Some(Resolution::error(
            ErrorCode::UserSettingVersionMismatch,
            Some(ErrorDetails {
                expected: input.expected_version.to_string(),
                found: got.version,
                at: path.to_string(),
            }),
        )),
        None => Some(Resolution::error(
            ErrorCode::UserSettingVersionMismatch,
            Some(ErrorDetails {
                expected: input.expected_version.to_string(),
                found: String::new(),
                at: path.to_string(),
            }),
        )),
    }
}

/// Handle the `env` source. Accepted unconditionally; warn on mismatch.
fn try_env<F>(input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    let path = env_path(input)?;
    let got = probe(&path)?;
    if !name_matches(input, &got) {
        return Some(Resolution::error(ErrorCode::BinaryNameMismatch, None));
    }
    Some(if got.version == input.expected_version {
        Resolution::ok(Source::Env, path, got.version)
    } else {
        Resolution::ok_warn(
            Source::Env,
            path,
            got.version,
            WarningCode::EnvVersionMismatch,
        )
    })
}

/// Handle the `path` source. Accepted only on exact match.
fn try_path<F>(input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    for entry in input.path_entries {
        let candidate = join_binary(entry, input.binary_name, input.platform);
        if let Some(got) = probe(&candidate) {
            if !name_matches(input, &got) {
                return Some(Resolution::error(ErrorCode::BinaryNameMismatch, None));
            }
            if got.version == input.expected_version {
                return Some(Resolution::ok(Source::Path, candidate, got.version));
            }
        }
    }
    None
}

/// Handle the `bundled` source. Accepted unconditionally; warn on drift.
fn try_bundled<F>(input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    let dir = input.bundled_dir?;
    let candidate = join_binary(dir, input.binary_name, input.platform);
    let got = probe(&candidate)?;
    if !name_matches(input, &got) {
        return Some(Resolution::error(ErrorCode::BinaryNameMismatch, None));
    }
    Some(if got.version == input.expected_version {
        Resolution::ok(Source::Bundled, candidate, got.version)
    } else {
        Resolution::ok_warn(
            Source::Bundled,
            candidate,
            got.version,
            WarningCode::BundledVersionDrift,
        )
    })
}

/// Handle the `cargo-bin` source (Basilisk/Zed fallback). Defers version
/// check to LSP `initialize` since the Zed host cannot spawn subprocesses.
fn try_cargo_bin(input: &ResolveInput<'_>) -> Option<Resolution> {
    input.cargo_bin.map(|p| {
        Resolution::deferred(
            Source::CargoBin,
            p.to_string(),
            DeferredCheck::LspInitialize,
        )
    })
}

/// Handle the `pkgmgr` source. Never auto-runs; produces a prompt.
fn try_pkgmgr(input: &ResolveInput<'_>) -> Option<Resolution> {
    input.pkgmgr.map(|p| {
        Resolution::prompt(PromptAction::PkgmgrInstall {
            commands: pkgmgr_commands(p),
        })
    })
}

/// Handle the `dotnet-tool` source. Install/update prompt on miss/mismatch.
fn try_dotnet_tool<F>(input: &ResolveInput<'_>, probe: &mut F) -> Option<Resolution>
where
    F: FnMut(&str) -> Option<ProbedVersion>,
{
    let dt = input.dotnet_tool?;
    let cmd = dt.command.as_deref().unwrap_or(&dt.package);
    Some(match probe(cmd) {
        Some(got) if got.version == input.expected_version => {
            Resolution::ok(Source::DotnetTool, cmd.to_string(), got.version)
        }
        Some(_) => Resolution::prompt(PromptAction::DotnetToolUpdate {
            command: format!(
                "dotnet tool update -g {} --version {}",
                dt.package, input.expected_version
            ),
        }),
        None => Resolution::prompt(PromptAction::DotnetToolUpdate {
            command: format!(
                "dotnet tool install -g {} --version {}",
                dt.package, input.expected_version
            ),
        }),
    })
}

/// Compare the probed binary name against the declared expectation.
fn name_matches(input: &ResolveInput<'_>, probed: &ProbedVersion) -> bool {
    match input.expected_name {
        Some(name) => probed.name == name,
        None => probed.name == input.binary_name,
    }
}

/// Resolve `env` source path: `pathVar` wins over `dirVar`.
fn env_path(input: &ResolveInput<'_>) -> Option<String> {
    if let Some(var) = input.env_config.path_var.as_deref() {
        if let Some(v) = input.env.get(var) {
            return Some(v.clone());
        }
    }
    if let Some(var) = input.env_config.dir_var.as_deref() {
        if let Some(dir) = input.env.get(var) {
            return Some(join_binary(dir, input.binary_name, input.platform));
        }
    }
    None
}

/// Join directory + binary name and append the platform `.exe` suffix.
fn join_binary(dir: &str, name: &str, platform: Platform) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    format!("{trimmed}/{name}{}", platform.exe_suffix())
}

/// Expand a `PkgmgrConfig` into a platform -> command map.
fn pkgmgr_commands(pkg: &PkgmgrConfig) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(b) = pkg.brew.as_deref() {
        for p in ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] {
            let _ = map.insert(p.to_string(), format!("brew install {b}"));
        }
    }
    if let Some(s) = pkg.scoop.as_deref() {
        let _ = map.insert("win32-x64".to_string(), format!("scoop install {s}"));
        let _ = map.insert("win32-arm64".to_string(), format!("scoop install {s}"));
    }
    map
}
