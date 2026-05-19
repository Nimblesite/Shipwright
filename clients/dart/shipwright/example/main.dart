// Minimal usage example for the shipwright package.
import 'package:shipwright/shipwright.dart';

void main() {
  final input = ResolveInput(
    binaryName: 'my-lsp',
    expectedVersion: '0.1.0',
    sources: const [Source.bundled, Source.path],
    bundledDir: 'bin/darwin-arm64',
  );

  final result = resolve(input, (_) => null);
  print('Resolved: ${result.status.wire}');
}
