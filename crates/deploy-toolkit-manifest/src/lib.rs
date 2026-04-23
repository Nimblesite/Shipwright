//! Manifest and binary version-output primitives for deploy-toolkit libraries.
//!
//! This crate intentionally has no Nimblesite-specific package name. Product
//! manifests and schema identifiers may be Nimblesite-specific while the public
//! reusable library stays generic.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("invalid binary name `{0}`")]
    InvalidName(String),
    #[error("invalid semver `{0}`")]
    InvalidVersion(String),
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutableKind {
    Cli,
    Lsp,
    Mcp,
    Sidecar,
    Dap,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Language {
    Rust,
    Dotnet,
    Dart,
    Typescript,
    Kotlin,
    Javascript,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionOutput {
    pub manifest_version: u32,
    pub name: String,
    pub version: String,
    pub kind: ExecutableKind,
    pub language: Language,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_dirty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
}

impl VersionOutput {
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

    pub fn with_product(mut self, product: impl Into<String>) -> Result<Self, ManifestError> {
        let product = product.into();
        validate_name(&product)?;
        self.product = Some(product);
        Ok(self)
    }

    pub fn with_capability(mut self, capability: impl Into<String>) -> Self {
        self.capabilities.push(capability.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductManifest {
    pub manifest_version: u32,
    pub product: Product,
    pub components: Vec<Component>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hosts: BTreeMap<String, HostPolicy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComponentKind {
    Cli,
    Lsp,
    Mcp,
    Sidecar,
    Dap,
    Tool,
    ExtensionVscode,
    ExtensionJetbrains,
    ExtensionZed,
    Asset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub id: String,
    pub kind: ComponentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Language>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
    #[serde(default = "default_required")]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub activation_verifies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_mismatch: Option<String>,
}

pub fn plain_version_line(name: &str, version: &str) -> Result<String, ManifestError> {
    validate_name(name)?;
    validate_semver(version)?;
    Ok(format!("{name} {version}"))
}

pub fn version_output_json(output: &VersionOutput) -> Result<String, ManifestError> {
    validate_name(&output.name)?;
    validate_semver(&output.version)?;
    if let Some(product) = &output.product {
        validate_name(product)?;
    }
    Ok(format!("{}\n", serde_json::to_string_pretty(output)?))
}

fn default_required() -> bool {
    true
}

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

fn numeric_part(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit())
}
