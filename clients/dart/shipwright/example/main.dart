// Minimal usage example for the deploy_toolkit package.
// DTK-REL-DART-SCORE
import 'package:deploy_toolkit/deploy_toolkit.dart';

Future<void> main() async {
  final resolver = DeployToolkitResolver();
  final result = await resolver.resolve(
    manifestPath: 'deployment-toolkit.json',
  );
  print('Resolved: $result');
}
