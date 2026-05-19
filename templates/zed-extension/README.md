# `templates/zed-extension`

Copy this directory into a Zed extension repo when the extension needs a
matching language server or tool binary. You get:

- A Rust/WASM extension scaffold.
- A `shipwright.json` manifest that declares the server contract.
- A startup pattern that defers version validation to LSP initialize when
  the host cannot preflight native binaries.

## Files

- `Cargo.toml.tpl` — rename to `Cargo.toml` and substitute placeholders.
- `extension.toml.tpl` — rename to `extension.toml`.
- `src/lib.rs` — extension entry point wired for shipwright-zed.
- `shipwright.json` — manifest for the Zed package.

## One-time bootstrap

```sh
export PRODUCT_ID=my-tool
export DISPLAY_NAME="My Tool"
export VERSION=0.1.0
export LSP_COMPONENT_ID=my-tool-lsp
export LSP_BINARY_NAME=my-tool-lsp
export ORG=my-org

sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{LSP_COMPONENT_ID}}/$LSP_COMPONENT_ID/g" \
    -e "s/{{LSP_BINARY_NAME}}/$LSP_BINARY_NAME/g" \
    -e "s/{{ORG}}/$ORG/g" \
    Cargo.toml.tpl > Cargo.toml
sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{ORG}}/$ORG/g" \
    extension.toml.tpl > extension.toml
rm Cargo.toml.tpl extension.toml.tpl
```

Build with the Zed-supported WASM target for your SDK version. Native
server binaries should still report the same version via `--version` and
LSP `serverInfo.version`.
