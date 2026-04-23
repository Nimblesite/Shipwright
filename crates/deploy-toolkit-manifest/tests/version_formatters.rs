use deploy_toolkit_manifest::{
    plain_version_line, version_output_json, ExecutableKind, Language, VersionOutput,
};
use serde_json::Value;

#[test]
fn plain_version_line_matches_fixture_contract() {
    let line = plain_version_line("deslop-lsp", "0.1.0").unwrap();
    assert_eq!(line, "deslop-lsp 0.1.0");
}

#[test]
fn json_version_output_matches_schema_shape() {
    let output = VersionOutput::new("deslop-lsp", "0.1.0", ExecutableKind::Lsp, Language::Rust)
        .unwrap()
        .with_product("deslop")
        .unwrap()
        .with_capability("version-flag")
        .with_capability("version-flag-json");

    let json = version_output_json(&output).unwrap();
    let parsed: Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["manifestVersion"], 1);
    assert_eq!(parsed["name"], "deslop-lsp");
    assert_eq!(parsed["version"], "0.1.0");
    assert_eq!(parsed["kind"], "lsp");
    assert_eq!(parsed["language"], "rust");
    assert_eq!(parsed["product"], "deslop");
    assert_eq!(parsed["capabilities"][0], "version-flag");
}

#[test]
fn invalid_names_and_versions_are_rejected() {
    assert!(plain_version_line("Deslop", "0.1.0").is_err());
    assert!(plain_version_line("deslop", "latest").is_err());
}
