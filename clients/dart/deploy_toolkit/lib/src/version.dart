/// Binary-side helpers: emit the `--version` contract from a Dart CLI.

import 'dart:convert';
import 'dart:io';

/// Declarative spec of what a binary should report.
class VersionSpec {
  const VersionSpec({
    required this.name,
    required this.version,
    required this.kind,
    required this.language,
    this.product,
    this.capabilities = const [],
    this.buildTime,
    this.gitSha,
    this.gitDirty,
    this.target,
    this.toolchain,
  });

  final String name;
  final String version;
  final String kind; // 'cli' | 'lsp' | 'mcp' | 'sidecar' | 'dap' | 'tool'
  final String language; // 'rust' | 'dotnet' | 'dart' | 'typescript' | 'kotlin' | 'javascript'
  final String? product;
  final List<String> capabilities;
  final String? buildTime;
  final String? gitSha;
  final bool? gitDirty;
  final String? target;
  final String? toolchain;
}

/// Run the `--version` contract against an argv slice.
///
/// Returns `true` when a version flag was handled (caller should exit 0);
/// `false` means continue normal execution.
bool handleVersion(List<String> argv, VersionSpec spec, {IOSink? out}) {
  final sink = out ?? stdout;
  final wantsVersion = argv.contains('--version') || argv.contains('-V');
  if (!wantsVersion) return false;
  final wantsJson = argv.contains('--json');
  if (wantsJson) {
    sink.writeln(_jsonManifest(spec));
  } else {
    sink.writeln('${spec.name} ${spec.version}');
  }
  return true;
}

String _jsonManifest(VersionSpec spec) {
  final m = <String, dynamic>{
    'manifestVersion': 1,
    'name': spec.name,
    'version': spec.version,
    'kind': spec.kind,
    'language': spec.language,
  };
  if (spec.buildTime != null) m['buildTime'] = spec.buildTime;
  if (spec.gitSha != null) m['gitSha'] = spec.gitSha;
  if (spec.gitDirty != null) m['gitDirty'] = spec.gitDirty;
  if (spec.target != null) m['target'] = spec.target;
  if (spec.toolchain != null) m['toolchain'] = spec.toolchain;
  if (spec.capabilities.isNotEmpty) m['capabilities'] = spec.capabilities;
  if (spec.product != null) m['product'] = spec.product;
  return jsonEncode(m);
}
