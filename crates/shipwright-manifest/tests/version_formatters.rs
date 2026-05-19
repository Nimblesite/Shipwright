//! Integration tests for version formatting functions.
use serde_json::{json, Value};
use shipwright_manifest::{
    plain_version_line, version_output_json, Component, ComponentKind, ExecutableKind, Language,
    ManifestError, VersionOutput,
};

#[test]
fn plain_version_line_matches_fixture_contract() -> Result<(), ManifestError> {
    let line = plain_version_line("deslop-lsp", "0.1.0")?;
    assert_eq!(line, "deslop-lsp 0.1.0");
    Ok(())
}

#[test]
fn json_version_output_matches_schema_shape() -> Result<(), ManifestError> {
    let output = VersionOutput::new("deslop-lsp", "0.1.0", ExecutableKind::Lsp, Language::Rust)?
        .with_product("deslop")?
        .with_capability("version-flag")
        .with_capability("version-flag-json");

    let json = version_output_json(&output)?;
    let parsed: Value = serde_json::from_str(&json)?;

    assert_eq!(parsed.get("manifestVersion"), Some(&Value::from(1u32)));
    assert_eq!(parsed.get("name"), Some(&Value::from("deslop-lsp")));
    assert_eq!(parsed.get("version"), Some(&Value::from("0.1.0")));
    assert_eq!(parsed.get("kind"), Some(&Value::from("lsp")));
    assert_eq!(parsed.get("language"), Some(&Value::from("rust")));
    assert_eq!(parsed.get("product"), Some(&Value::from("deslop")));
    let caps = parsed.get("capabilities").and_then(Value::as_array);
    assert!(caps.is_some(), "capabilities should be an array");
    assert_eq!(
        caps.and_then(|a| a.first()),
        Some(&Value::from("version-flag")),
    );
    Ok(())
}

#[test]
fn json_version_output_omits_absent_optional_fields() -> Result<(), ManifestError> {
    let output = VersionOutput::new("shipwright", "1.2.3", ExecutableKind::Cli, Language::Rust)?;
    let parsed: Value = serde_json::from_str(&version_output_json(&output)?)?;

    assert_eq!(parsed.get("name"), Some(&Value::from("shipwright")));
    assert_eq!(parsed.get("version"), Some(&Value::from("1.2.3")));
    assert_eq!(parsed.get("product"), None);
    assert_eq!(parsed.get("capabilities"), None);
    Ok(())
}

#[test]
fn invalid_names_and_versions_are_rejected() {
    assert!(plain_version_line("Deslop", "0.1.0").is_err());
    assert!(plain_version_line("deslop", "latest").is_err());
}

#[test]
fn name_validation_rejects_empty_short_long_and_bad_inner_characters() {
    for name in ["", "a", "deslop_lsp"] {
        assert!(matches!(
            plain_version_line(name, "0.1.0"),
            Err(ManifestError::InvalidName(_)),
        ));
    }

    let too_long = "a".repeat(65);
    assert!(matches!(
        plain_version_line(&too_long, "0.1.0"),
        Err(ManifestError::InvalidName(value)) if value == too_long,
    ));
}

#[test]
fn semver_accepts_suffixes_and_rejects_missing_numeric_parts() -> Result<(), ManifestError> {
    let line = plain_version_line("tool-1", "1.2.3-alpha.1+build.5")?;
    assert_eq!(line, "tool-1 1.2.3-alpha.1+build.5");
    assert!(matches!(
        plain_version_line("tool-1", "1.2"),
        Err(ManifestError::InvalidVersion(value)) if value == "1.2",
    ));
    assert!(matches!(
        plain_version_line("tool-1", "1.2.x"),
        Err(ManifestError::InvalidVersion(value)) if value == "1.2.x",
    ));
    Ok(())
}

#[test]
fn version_output_json_revalidates_product_field() -> Result<(), ManifestError> {
    let mut output =
        VersionOutput::new("deslop-lsp", "0.1.0", ExecutableKind::Lsp, Language::Rust)?;
    output.product = Some("Bad Product".to_string());
    assert!(matches!(
        version_output_json(&output),
        Err(ManifestError::InvalidName(value)) if value == "Bad Product",
    ));
    Ok(())
}

#[test]
fn component_serde_defaults_required_and_uses_kebab_case() -> Result<(), ManifestError> {
    let component: Component =
        serde_json::from_value(json!({"id": "zed-package", "kind": "extension-zed"}))?;
    assert_eq!(component.kind, ComponentKind::ExtensionZed);
    assert!(component.required);

    let serialized = serde_json::to_value(&component)?;
    assert_eq!(
        serialized,
        json!({"id": "zed-package", "kind": "extension-zed", "required": true}),
    );
    Ok(())
}
