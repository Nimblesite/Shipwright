// Minimal usage example for the shipwright package.
import 'dart:io';

import 'package:shipwright/shipwright.dart';

void main() {
  const input = ResolveInput(
    binaryName: 'my-lsp',
    expectedVersion: '0.1.0',
    sources: [Source.bundled, Source.path],
    bundledDir: 'bin/darwin-arm64',
  );

  final result = resolve(input, (_) => null);
  stdout.writeln('Resolved: ${result.status.wire}');
}
