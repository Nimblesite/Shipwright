# shipwright-manifest

Rust data types for the Shipwright version-output contract and deployment manifest schema.

This crate is the single source of truth for the manifest structure — all other language clients are derived from the same schema. It has no I/O and no product-specific logic.

## Usage

```toml
[dependencies]
shipwright-manifest = "0.1"
```

```rust
use shipwright_manifest::ProductManifest;

let manifest: ProductManifest = serde_json::from_str(json)?;
```

## License

Licensed under either of [MIT](../../LICENSE) or [Apache-2.0](../../LICENSE) at your option.

Copyright (c) 2026 NIMBLESITE PTY LTD
