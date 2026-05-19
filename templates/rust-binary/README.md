# `templates/rust-binary`

Copy this directory into a new repo to start a Rust CLI/LSP/MCP that
participates in shipwright out of the box. You get:

- A binary whose `--version` and `--version --json` already match the
  shipwright contract (`schemas/version-manifest.schema.json`).
- `build.rs` emitting `GIT_SHA`, `BUILD_TIME`, and toolchain info.
- A `shipwright.json` product manifest.
- A `release.yml` that delegates to the reusable release orchestrator.

## Files

- `Cargo.toml.tpl` — rename to `Cargo.toml` and substitute `{{PRODUCT_ID}}`,
  `{{BINARY_NAME}}`, `{{VERSION}}`.
- `src/main.rs` — entry point that wires `shipwright-cli::dispatch`.
- `build.rs` — emits the compile-time env vars.
- `shipwright.json` — single-component manifest; add components as
  the product grows.
- `release.yml` — move to `.github/workflows/release.yml`.

## One-time bootstrap

```sh
export PRODUCT_ID=my-tool
export BINARY_NAME=my-tool
export VERSION=0.1.0

sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{BINARY_NAME}}/$BINARY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    Cargo.toml.tpl > Cargo.toml
rm Cargo.toml.tpl
```

Then `cargo run -- --version` should print `my-tool 0.1.0` and
`cargo run -- --version --json` should emit schema-valid JSON.
