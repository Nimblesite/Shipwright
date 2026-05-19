# shipwright-host

Pure binary-resolution algorithm for Shipwright IDE extension hosts.

This crate contains **no I/O**. The version-probe function is injected by the caller (an IDE extension or CLI wrapper), keeping this crate fully testable in isolation and usable across all host environments.

## Usage

```toml
[dependencies]
shipwright-host = "0.1"
```

```rust
use shipwright_host::{resolve, Probe};

let result = resolve(&manifest, |binary, args| {
    // caller-provided probe: spawn the binary, capture stdout
});
```

## License

Licensed under either of [MIT](../../LICENSE) or [Apache-2.0](../../LICENSE) at your option.

Copyright (c) 2026 NIMBLESITE PTY LTD
