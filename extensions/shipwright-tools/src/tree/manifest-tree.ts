import * as vscode from "vscode";
import type { ShipwrightManifest, Component, HostPolicy } from "../types";
import { tryParseManifest } from "../types";

type TreeNode = ProductNode | ComponentsNode | ComponentNode | HostsNode | HostNode | PropertyNode | PlatformChipNode;

interface ProductNode {
  kind: "product";
  manifest: ShipwrightManifest;
}
interface ComponentsNode {
  kind: "components";
  items: Component[];
}
interface ComponentNode {
  kind: "component";
  item: Component;
}
interface HostsNode {
  kind: "hosts";
  hosts: Record<string, HostPolicy>;
}
interface HostNode {
  kind: "host";
  name: string;
  policy: HostPolicy;
}
interface PropertyNode {
  kind: "property";
  label: string;
  value: string;
}
interface PlatformChipNode {
  kind: "platform";
  label: string;
}

export class ManifestTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private manifest: ShipwrightManifest | undefined;

  static register(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): vscode.Disposable[] {
    const provider = new ManifestTreeProvider();
    const tree = vscode.window.createTreeView("shipwright.manifestTree", {
      treeDataProvider: provider,
      showCollapseAll: true,
    });
    const refresh = vscode.commands.registerCommand("shipwright.refreshTree", () => {
      provider.reload();
    });
    const watcher = vscode.workspace.createFileSystemWatcher("**/shipwright.json");
    watcher.onDidChange(() => provider.reload());
    watcher.onDidCreate(() => provider.reload());
    watcher.onDidDelete(() => provider.reload());

    provider.reload();
    output.info("Manifest tree registered");
    return [tree, refresh, watcher];
  }

  async reload(): Promise<void> {
    const files = await vscode.workspace.findFiles("**/shipwright.json", "**/node_modules/**", 5);
    if (files.length > 0) {
      const doc = await vscode.workspace.openTextDocument(files[0]);
      this.manifest = tryParseManifest(doc.getText());
    } else {
      this.manifest = undefined;
    }
    this._onDidChange.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "product":
        return this.productItem(node.manifest);
      case "components":
        return this.section("Components", node.items.length, vscode.TreeItemCollapsibleState.Expanded);
      case "component":
        return this.componentItem(node.item);
      case "hosts":
        return this.section("Hosts", Object.keys(node.hosts).length, vscode.TreeItemCollapsibleState.Expanded);
      case "host":
        return this.hostItem(node);
      case "property":
        return this.propItem(node);
      case "platform":
        return this.chipItem(node);
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return this.rootChildren();
    }
    switch (node.kind) {
      case "product":
        return this.productChildren(node.manifest);
      case "components":
        return node.items.map((item) => ({ kind: "component" as const, item }));
      case "component":
        return this.componentChildren(node.item);
      case "hosts":
        return Object.entries(node.hosts).map(([name, policy]) => ({ kind: "host" as const, name, policy }));
      case "host":
        return this.hostChildren(node);
      default:
        return [];
    }
  }

  private rootChildren(): TreeNode[] {
    if (!this.manifest) {
      return [];
    }
    const nodes: TreeNode[] = [
      { kind: "product", manifest: this.manifest },
      { kind: "components", items: this.manifest.components },
    ];
    if (this.manifest.hosts) {
      nodes.push({ kind: "hosts", hosts: this.manifest.hosts });
    }
    return nodes;
  }

  private productChildren(m: ShipwrightManifest): TreeNode[] {
    const props: TreeNode[] = [
      { kind: "property", label: "ID", value: m.product.id },
      { kind: "property", label: "Version", value: m.product.version },
    ];
    if (m.product.displayName) {
      props.push({ kind: "property", label: "Display Name", value: m.product.displayName });
    }
    if (m.product.repository) {
      props.push({ kind: "property", label: "Repository", value: m.product.repository });
    }
    return props;
  }

  private componentChildren(c: Component): TreeNode[] {
    const props: TreeNode[] = [{ kind: "property", label: "Kind", value: c.kind }];
    if (c.language) {
      props.push({ kind: "property", label: "Language", value: c.language });
    }
    if (c.binaryName) {
      props.push({ kind: "property", label: "Binary", value: c.binaryName });
    }
    if (c.expectedVersion) {
      props.push({ kind: "property", label: "Version", value: c.expectedVersion });
    }
    if (c.sources) {
      props.push({ kind: "property", label: "Sources", value: c.sources.join(" → ") });
    }
    if (c.platforms) {
      for (const p of c.platforms) {
        props.push({ kind: "platform", label: p });
      }
    }
    return props;
  }

  private hostChildren(node: HostNode): TreeNode[] {
    const props: TreeNode[] = [];
    if (node.policy.artifact) {
      props.push({ kind: "property", label: "Artifact", value: node.policy.artifact });
    }
    if (node.policy.activationVerifies) {
      props.push({ kind: "property", label: "Verifies", value: node.policy.activationVerifies.join(", ") });
    }
    if (node.policy.onMismatch) {
      props.push({ kind: "property", label: "On Mismatch", value: node.policy.onMismatch });
    }
    return props;
  }

  private productItem(m: ShipwrightManifest): vscode.TreeItem {
    const item = new vscode.TreeItem(m.product.displayName ?? m.product.id, vscode.TreeItemCollapsibleState.Expanded);
    item.description = `v${m.product.version}`;
    item.iconPath = new vscode.ThemeIcon("package");
    item.contextValue = "product";
    return item;
  }

  private section(label: string, count: number, state: vscode.TreeItemCollapsibleState): vscode.TreeItem {
    const item = new vscode.TreeItem(label, state);
    item.description = `(${count})`;
    item.iconPath = new vscode.ThemeIcon("list-tree");
    return item;
  }

  private componentItem(c: Component): vscode.TreeItem {
    const item = new vscode.TreeItem(c.id, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${c.kind}${c.language ? ` · ${c.language}` : ""}`;
    item.iconPath = new vscode.ThemeIcon(kindIcon(c.kind));
    item.contextValue = "component";
    return item;
  }

  private hostItem(node: HostNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = node.policy.artifact ?? "";
    item.iconPath = new vscode.ThemeIcon("window");
    return item;
  }

  private propItem(node: PropertyNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.value;
    item.iconPath = new vscode.ThemeIcon("symbol-field");
    return item;
  }

  private chipItem(node: PlatformChipNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("device-desktop");
    return item;
  }
}

function kindIcon(kind: string): string {
  const map: Record<string, string> = {
    cli: "terminal",
    lsp: "symbol-method",
    mcp: "plug",
    sidecar: "server-process",
    dap: "debug-alt",
    tool: "tools",
    "extension-vscode": "extensions",
    "extension-jetbrains": "extensions",
    "extension-zed": "extensions",
    asset: "file-binary",
  };
  return map[kind] ?? "symbol-misc";
}
