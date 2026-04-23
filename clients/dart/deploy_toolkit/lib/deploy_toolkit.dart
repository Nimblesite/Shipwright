/// Dart port of the `deploy-toolkit` resolver and `--version` helpers.
///
/// Public API mirrors `crates/deploy-toolkit-host` and
/// `clients/ts/packages/deploy-toolkit-core`. All language ports MUST pass
/// the vectors in `schemas/test-vectors.json` bit-for-bit.
library deploy_toolkit;

export 'src/resolve.dart';
export 'src/version.dart';
