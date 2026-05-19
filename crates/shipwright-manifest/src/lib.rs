//! Manifest and binary version-output primitives for shipwright libraries.
//!
//! This crate intentionally has no Nimblesite-specific package name. Product
//! manifests and schema identifiers may be Nimblesite-specific while the public
//! reusable library stays generic.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Schema version emitted in every `VersionOutput` JSON payload.
pub const MANIFEST_VERSION: u32 = 1;

/// Errors produced when constructing or serializing version/manifest types.
#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    /// A binary or product name failed the naming rules (lowercase alphanumeric + hyphens, 2–64 chars).
    #[error("invalid binary name `{0}`")]
    InvalidName(String),
    /// A version string is not a valid semantic version.
    #[error("invalid semver `{0}`")]
    InvalidVersion(String),
    /// JSON serialization failed.
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

/// The role a binary plays within a product.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutableKind {
    /// Command-line interface binary.
    Cli,
    /// Language server protocol binary.
    Lsp,
    /// Model context protocol binary.
    Mcp,
    /// Long-running background process.
    Sidecar,
    /// Debug adapter protocol binary.
    Dap,
    /// General-purpose tool binary.
    Tool,
}

/// The implementation language of a component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Language {
    /// Rust native binary.
    Rust,
    /// .NET / C# binary.
    Dotnet,
    /// Dart binary.
    Dart,
    /// TypeScript / Node.js binary.
    Typescript,
    /// Kotlin / JVM binary.
    Kotlin,
    /// Plain JavaScript binary.
    Javascript,
}

/// The structured JSON payload emitted by `binary --version --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionOutput {
    /// Schema version; always [`MANIFEST_VERSION`].
    pub manifest_version: u32,
    /// Stable binary name (lowercase alphanumeric + hyphens).
    pub name: String,
    /// Semantic version of this binary build.
    pub version: String,
    /// Role this binary plays.
    pub kind: ExecutableKind,
    /// Implementation language.
    pub language: Language,
    /// ISO-8601 build timestamp, if embedded at build time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_time: Option<String>,
    /// Full git commit SHA, if embedded at build time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_sha: Option<String>,
    /// Whether the working tree was dirty at build time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_dirty: Option<bool>,
    /// Rust target triple (e.g. `x86_64-unknown-linux-gnu`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Rust toolchain channel (e.g. `stable`, `1.75.0`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<String>,
    /// Optional feature flags or protocol extensions advertised by this binary.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    /// Owning product name, if this binary is product-specific.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
}

impl VersionOutput {
    /// Construct a minimal [`VersionOutput`], validating `name` and `version`.
    ///
    /// # Errors
    ///
    /// Returns [`ManifestError::InvalidName`] if `name` violates naming rules,
    /// or [`ManifestError::InvalidVersion`] if `version` is not a valid semver.
    pub fn new(
        name: impl Into<String>,
        version: impl Into<String>,
        kind: ExecutableKind,
        language: Language,
    ) -> Result<Self, ManifestError> {
        let name = name.into();
        let version = version.into();
        validate_name(&name)?;
        validate_semver(&version)?;

        Ok(Self {
            manifest_version: MANIFEST_VERSION,
            name,
            version,
            kind,
            language,
            build_time: None,
            git_sha: None,
            git_dirty: None,
            target: None,
            toolchain: None,
            capabilities: Vec::new(),
            product: None,
        })
    }

    /// Attach a product name, validating it against the naming rules.
    ///
    /// # Errors
    ///
    /// Returns [`ManifestError::InvalidName`] if `product` violates naming rules.
    pub fn with_product(mut self, product: impl Into<String>) -> Result<Self, ManifestError> {
        let product = product.into();
        validate_name(&product)?;
        self.product = Some(product);
        Ok(self)
    }

    /// Append a capability string.
    #[must_use]
    pub fn with_capability(mut self, capability: impl Into<String>) -> Self {
        self.capabilities.push(capability.into());
        self
    }
}

/// The top-level deployment manifest (`shipwright.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductManifest {
    /// Schema version; always [`MANIFEST_VERSION`].
    pub manifest_version: u32,
    /// Product metadata.
    pub product: Product,
    /// Ordered list of components managed by this manifest.
    pub components: Vec<Component>,
    /// Per-host override policies, keyed by host identifier.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hosts: BTreeMap<String, HostPolicy>,
}

/// Product-level metadata within a [`ProductManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    /// Stable product identifier.
    pub id: String,
    /// Human-readable product name shown in IDE UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Semantic version of this manifest.
    pub version: String,
    /// Source repository URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// Product homepage URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
}

/// The role a component plays in the IDE extension host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComponentKind {
    /// Command-line interface binary.
    Cli,
    /// Language server protocol binary.
    Lsp,
    /// Model context protocol binary.
    Mcp,
    /// Long-running background process.
    Sidecar,
    /// Debug adapter protocol binary.
    Dap,
    /// General-purpose tool binary.
    Tool,
    /// VS Code extension package.
    ExtensionVscode,
    /// `JetBrains` plugin package.
    ExtensionJetbrains,
    /// Zed extension package.
    ExtensionZed,
    /// Static downloadable asset.
    Asset,
}

/// A single managed component within a [`ProductManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    /// Stable component identifier.
    pub id: String,
    /// Role this component plays.
    pub kind: ComponentKind,
    /// Implementation language, if applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Language>,
    /// Filesystem name of the binary executable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_name: Option<String>,
    /// Expected semantic version; used by the host resolution algorithm.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<String>,
    /// Platforms this component targets (e.g. `darwin-arm64`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    /// Download/install source URIs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
    /// Whether the IDE extension should refuse to start if this component is absent.
    #[serde(default = "default_required")]
    pub required: bool,
}

/// Per-host override policy within a [`ProductManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPolicy {
    /// Override artifact path for this host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<String>,
    /// Component IDs whose version must be verified on host activation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub activation_verifies: Vec<String>,
    /// Action to take when a version mismatch is detected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mismatch: Option<String>,
}

/// Format the plain-text `--version` line: `"{name} {version}"`.
///
/// # Errors
///
/// Returns [`ManifestError::InvalidName`] or [`ManifestError::InvalidVersion`] if inputs are invalid.
pub fn plain_version_line(name: &str, version: &str) -> Result<String, ManifestError> {
    validate_name(name)?;
    validate_semver(version)?;
    Ok(format!("{name} {version}"))
}

/// Serialize a [`VersionOutput`] to pretty-printed JSON with a trailing newline.
///
/// Re-validates `name`, `version`, and optional `product` before serializing.
///
/// # Errors
///
/// Returns [`ManifestError`] if any field fails validation or JSON serialization fails.
pub fn version_output_json(output: &VersionOutput) -> Result<String, ManifestError> {
    validate_name(&output.name)?;
    validate_semver(&output.version)?;
    if let Some(product) = &output.product {
        validate_name(product)?;
    }
    Ok(format!("{}\n", serde_json::to_string_pretty(output)?))
}

/// Serde default: components are required unless explicitly set to `false`.
fn default_required() -> bool {
    true
}

/// Returns `true` if `value` satisfies binary/product naming rules.
fn validate_name(value: &str) -> Result<(), ManifestError> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(ManifestError::InvalidName(value.to_string()));
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err(ManifestError::InvalidName(value.to_string()));
    }
    if value.len() < 2 || value.len() > 64 {
        return Err(ManifestError::InvalidName(value.to_string()));
    }
    if !chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-') {
        return Err(ManifestError::InvalidName(value.to_string()));
    }
    Ok(())
}

/// Returns `Ok` if `value` is a valid `MAJOR.MINOR.PATCH` semver (pre-release/build suffixes accepted).
fn validate_semver(value: &str) -> Result<(), ManifestError> {
    let core = value.split_once(['-', '+']).map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    let valid = matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if numeric_part(major) && numeric_part(minor) && numeric_part(patch)
    );
    if valid {
        Ok(())
    } else {
        Err(ManifestError::InvalidVersion(value.to_string()))
    }
}

/// Returns `true` if `value` is a non-empty ASCII-digit string.
fn numeric_part(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit())
}
