# shipwright (Dart)

Dart client for the Shipwright binary resolver and `--version` contract.

Use this package in Dart or Flutter applications that need to locate and verify Shipwright-managed binaries before launching them.

## Installation

```yaml
dependencies:
  shipwright: ^0.1.0
```

## Usage

```dart
import 'package:shipwright/shipwright.dart';

final resolver = ShipwrightResolver();
final result = await resolver.resolve(manifestPath: 'shipwright.json');
```

See the [`example/`](example/) directory for a complete working example.

## License

Licensed under the [MIT](LICENSE) license.

Copyright (c) 2026 NIMBLESITE PTY LTD
