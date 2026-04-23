# `templates/vscode-extension`

Copy this directory into a VS Code extension repo to opt in to
deploy-toolkit startup validation. You get:

- A `deployment-toolkit.json` manifest that declares bundled LSP/MCP
  binaries under `bin/<platform>`.
- Activation code that calls `@deploy-toolkit/vscode` before starting the
  real extension features.
- User settings for a shared binary directory and per-component overrides.

## Files

- `package.json.tpl` — rename to `package.json` and substitute placeholders.
- `tsconfig.json` — TypeScript settings for the scaffold.
- `src/extension.ts` — activation gate that verifies binaries first.
- `deployment-toolkit.json` — VSIX manifest; add components as needed.

## One-time bootstrap

```sh
export PRODUCT_ID=my-tool
export EXTENSION_ID=my-tool-vscode
export DISPLAY_NAME="My Tool"
export VERSION=0.1.0
export PUBLISHER=my-org
export LSP_COMPONENT_ID=my-tool-lsp
export LSP_BINARY_NAME=my-tool-lsp
export MCP_COMPONENT_ID=my-tool-mcp
export MCP_BINARY_NAME=my-tool-mcp

sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{EXTENSION_ID}}/$EXTENSION_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{PUBLISHER}}/$PUBLISHER/g" \
    -e "s/{{LSP_COMPONENT_ID}}/$LSP_COMPONENT_ID/g" \
    -e "s/{{LSP_BINARY_NAME}}/$LSP_BINARY_NAME/g" \
    -e "s/{{MCP_COMPONENT_ID}}/$MCP_COMPONENT_ID/g" \
    -e "s/{{MCP_BINARY_NAME}}/$MCP_BINARY_NAME/g" \
    package.json.tpl > package.json
rm package.json.tpl
```

Bundle binaries at `bin/<platform>/<binaryName>` before packaging the VSIX.
The extension can only continue activation after every component listed in
`hosts.vscode.activationVerifies` reports the manifest version.
