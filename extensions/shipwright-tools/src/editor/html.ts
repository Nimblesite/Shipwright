import * as vscode from "vscode";

export function buildEditorHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "editor.css"),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "editor.js"),
  );
  const nonce = generateNonce();
  const csp = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${csp} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <link href="${cssUri}" rel="stylesheet">
  <title>Shipwright Manifest</title>
</head>
<body>
  <div id="root">
    <div class="loading">Loading manifest&hellip;</div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
