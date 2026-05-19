/// Runs every vector from `schemas/test-vectors.json` through `resolve`.
///
/// Keeps parity with the Rust + TS reference implementations.

import 'dart:convert';
import 'dart:io';

import 'package:deploy_toolkit/deploy_toolkit.dart';
import 'package:test/test.dart';

void main() {
  test('resolver passes every vector', () {
    final vectorsFile = File(
      '${Directory.current.path}/../../../schemas/test-vectors.json',
    );
    expect(vectorsFile.existsSync(), isTrue,
        reason: 'test-vectors.json must exist at ${vectorsFile.path}');

    final doc = jsonDecode(vectorsFile.readAsStringSync()) as Map<String, dynamic>;
    final vectors = doc['vectors'] as List<dynamic>;

    final failures = <String>[];
    for (final raw in vectors) {
      final v = raw as Map<String, dynamic>;
      final id = v['id'] as String;
      try {
        _runVector(v);
      } on _MismatchError catch (e) {
        failures.add('$id: ${e.message}');
      }
    }
    expect(failures, isEmpty, reason: failures.join('\n'));
  });
}

void _runVector(Map<String, dynamic> v) {
  final input = v['input'] as Map<String, dynamic>;
  final expected = v['expect'] as Map<String, dynamic>;

  final probeMap = <String, ProbedVersion>{};
  final rawProbe = input['probe'];
  if (rawProbe is Map<String, dynamic>) {
    rawProbe.forEach((k, val) {
      final m = val as Map<String, dynamic>;
      probeMap[k] = ProbedVersion(m['name'] as String, m['version'] as String);
    });
  }

  final expectedName = input['expectedName'] as String?;
  final sources = (input['sources'] as List<dynamic>)
      .map((s) => Source.fromWire(s as String))
      .whereType<Source>()
      .toList();

  final binaryName = expectedName ?? (probeMap.values.isNotEmpty
      ? probeMap.values.first.name
      : 'deslop-lsp');

  final platform = _platform(input['platform'] as String?);

  final envConfigRaw = input['envConfig'] as Map<String, dynamic>?;

  final result = resolve(
    ResolveInput(
      binaryName: binaryName,
      expectedName: expectedName,
      expectedVersion: input['expectedVersion'] as String,
      sources: sources,
      platform: platform,
      userSettingPath: input['userSettingPath'] as String?,
      env: _stringMap(input['env']),
      envConfig: EnvConfig(
        pathVar: envConfigRaw?['pathVar'] as String?,
        dirVar: envConfigRaw?['dirVar'] as String?,
      ),
      pathEntries: (input['path'] as List<dynamic>?)?.cast<String>() ?? const [],
      bundledDir: input['bundledDir'] as String?,
      cargoBin: input['cargoBin'] as String?,
      pkgmgr: _pkgmgr(input['pkgmgr']),
      dotnetTool: _dotnetTool(input['dotnetTool']),
    ),
    (p) => probeMap[p],
  );

  _expect(result, expected);
}

Platform _platform(String? s) => switch (s ?? 'darwin-arm64') {
      'darwin-arm64' => Platform.darwinArm64,
      'darwin-x64' => Platform.darwinX64,
      'linux-x64' => Platform.linuxX64,
      'linux-arm64' => Platform.linuxArm64,
      'win32-x64' => Platform.win32X64,
      'win32-arm64' => Platform.win32Arm64,
      _ => Platform.all,
    };

Map<String, String> _stringMap(dynamic v) {
  if (v is! Map) return const {};
  return {
    for (final e in v.entries) e.key as String: e.value as String,
  };
}

PkgmgrConfig? _pkgmgr(dynamic v) {
  if (v is! Map<String, dynamic>) return null;
  return PkgmgrConfig(
    brew: v['brew'] as String?,
    scoop: v['scoop'] as String?,
    apt: v['apt'] as String?,
    winget: v['winget'] as String?,
  );
}

DotnetToolConfig? _dotnetTool(dynamic v) {
  if (v is! Map<String, dynamic>) return null;
  return DotnetToolConfig(
    package: v['package'] as String,
    command: v['command'] as String?,
  );
}

void _expect(Resolution r, Map<String, dynamic> want) {
  final wantStatus = want['status'] as String;
  final gotStatus = _statusWire(r.status);
  if (gotStatus != wantStatus) {
    throw _MismatchError('status want=$wantStatus got=$gotStatus');
  }
  if (want['source'] is String) {
    final gotSource = r.source?.wire;
    if (gotSource != want['source']) {
      throw _MismatchError('source want=${want['source']} got=$gotSource');
    }
  }
  if (want['path'] is String && r.path != want['path']) {
    throw _MismatchError('path want=${want['path']} got=${r.path}');
  }
  if (want['version'] is String && r.version != want['version']) {
    throw _MismatchError('version want=${want['version']} got=${r.version}');
  }
  if (want['errorCode'] is String) {
    final got = _errorWire(r.errorCode);
    if (got != want['errorCode']) {
      throw _MismatchError('errorCode want=${want['errorCode']} got=$got');
    }
  }
  if (want['warningCode'] is String) {
    final got = _warningWire(r.warningCode);
    if (got != want['warningCode']) {
      throw _MismatchError('warningCode want=${want['warningCode']} got=$got');
    }
  }
  if (want['deferredCheck'] is String) {
    final got = r.deferredCheck == null ? null : 'lsp-initialize';
    if (got != want['deferredCheck']) {
      throw _MismatchError('deferredCheck want=${want['deferredCheck']} got=$got');
    }
  }
  if (want['action'] is Map) {
    final gotJson = r.action?.toJson();
    if (!_jsonEquals(gotJson, want['action'] as Map<String, dynamic>)) {
      throw _MismatchError('action mismatch. want=${want['action']} got=$gotJson');
    }
  }
}

String _statusWire(Status s) => switch (s) {
      Status.ok => 'ok',
      Status.okWithWarning => 'ok-with-warning',
      Status.deferred => 'deferred',
      Status.prompt => 'prompt',
      Status.error => 'error',
    };

String? _errorWire(ErrorCode? e) => switch (e) {
      ErrorCode.userSettingVersionMismatch => 'user-setting-version-mismatch',
      ErrorCode.noSourceResolved => 'no-source-resolved',
      ErrorCode.binaryNameMismatch => 'binary-name-mismatch',
      null => null,
    };

String? _warningWire(WarningCode? w) => switch (w) {
      WarningCode.envVersionMismatch => 'env-version-mismatch',
      WarningCode.bundledVersionDrift => 'bundled-version-drift',
      null => null,
    };

bool _jsonEquals(dynamic a, dynamic b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!_jsonEquals(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_jsonEquals(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

class _MismatchError implements Exception {
  _MismatchError(this.message);
  final String message;
}
