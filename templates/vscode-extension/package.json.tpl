{
  "name": "{{EXTENSION_ID}}",
  "displayName": "{{DISPLAY_NAME}}",
  "publisher": "{{PUBLISHER}}",
  "version": "{{VERSION}}",
  "engines": {
    "vscode": "^1.95.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "files": [
    "dist",
    "bin",
    "deployment-toolkit.json",
    "package.json",
    "README.md"
  ],
  "contributes": {
    "configuration": {
      "title": "{{DISPLAY_NAME}}",
      "properties": {
        "{{PRODUCT_ID}}.binaries.path": {
          "type": "string",
          "default": "",
          "description": "Directory containing matching {{DISPLAY_NAME}} binaries."
        },
        "{{PRODUCT_ID}}.binaries.{{LSP_COMPONENT_ID}}": {
          "type": "string",
          "default": "",
          "description": "Absolute path to the {{LSP_COMPONENT_ID}} binary."
        },
        "{{PRODUCT_ID}}.binaries.{{MCP_COMPONENT_ID}}": {
          "type": "string",
          "default": "",
          "description": "Absolute path to the {{MCP_COMPONENT_ID}} binary."
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p .",
    "package": "vsce package",
    "prepackage": "npm run compile"
  },
  "dependencies": {
    "@deploy-toolkit/vscode": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "@types/vscode": "^1.95.0",
    "@vscode/vsce": "^3.2.1",
    "typescript": "^5.9.3"
  }
}
