/// Dart port of the Shipwright resolver and `--version` helpers.
///
/// Public API mirrors `crates/shipwright-host` and
/// `clients/ts/packages/shipwright-core`. All language ports MUST pass
/// the vectors in `schemas/test-vectors.json` bit-for-bit.
library shipwright;

export 'src/resolve.dart';
export 'src/version.dart';
