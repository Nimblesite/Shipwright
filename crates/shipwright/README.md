# shipwright

Binary-side helper for the Shipwright version contract.

Provides the functions a binary calls to emit its version in the two required formats:

- `binary --version` → `"binary-name 1.2.3"`
- `binary --version --json` → structured JSON per `schemas/version-manifest.schema.json`

## Usage

```toml
[dependencies]
shipwright = "0.1"
```

```rust
use shipwright::{plain_version_line, version_output_json, VersionOutput, ExecutableKind, Language};

let output = VersionOutput::new("my-tool", env!("CARGO_PKG_VERSION"), ExecutableKind::Cli, Language::Rust)
    .expect("valid name and version");

// plain: "my-tool 1.2.3"
println!("{}", plain_version_line("my-tool", env!("CARGO_PKG_VERSION"))?);

// json: structured version-manifest JSON
println!("{}", version_output_json(&output)?);
```

## License

Licensed under the [MIT](../../LICENSE) license.

Copyright (c) 2026 NIMBLESITE PTY LTD
