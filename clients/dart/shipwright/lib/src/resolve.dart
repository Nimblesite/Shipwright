/// Pure resolver: no I/O, caller supplies `probe`.

/// Ordered discovery sources declared in `shipwright.schema.json`.
enum Source {
  userSetting,
  env,
  path,
  bundled,
  pkgmgr,
  dotnetTool,
  npmGlobal,
  cargoBin,
  githubRelease,
  lspInitialize;

  /// Kebab-case serialization used in manifests and test vectors.
  String get wire => switch (this) {
        Source.userSetting => 'user-setting',
        Source.env => 'env',
        Source.path => 'path',
        Source.bundled => 'bundled',
        Source.pkgmgr => 'pkgmgr',
        Source.dotnetTool => 'dotnet-tool',
        Source.npmGlobal => 'npm-global',
        Source.cargoBin => 'cargo-bin',
        Source.githubRelease => 'github-release',
        Source.lspInitialize => 'lsp-initialize',
      };

  /// Parse the kebab-case wire form.
  static Source? fromWire(String s) => switch (s) {
        'user-setting' => Source.userSetting,
        'env' => Source.env,
        'path' => Source.path,
        'bundled' => Source.bundled,
        'pkgmgr' => Source.pkgmgr,
        'dotnet-tool' => Source.dotnetTool,
        'npm-global' => Source.npmGlobal,
        'cargo-bin' => Source.cargoBin,
        'github-release' => Source.githubRelease,
        'lsp-initialize' => Source.lspInitialize,
        _ => null,
      };
}

/// Canonical platform identifiers.
enum Platform {
  darwinArm64,
  darwinX64,
  linuxX64,
  linuxArm64,
  win32X64,
  win32Arm64,
  all;

  String get wire => switch (this) {
        Platform.darwinArm64 => 'darwin-arm64',
        Platform.darwinX64 => 'darwin-x64',
        Platform.linuxX64 => 'linux-x64',
        Platform.linuxArm64 => 'linux-arm64',
        Platform.win32X64 => 'win32-x64',
        Platform.win32Arm64 => 'win32-arm64',
        Platform.all => 'all',
      };

  /// Windows platforms append `.exe`; everything else appends nothing.
  String get exeSuffix => switch (this) {
        Platform.win32X64 || Platform.win32Arm64 => '.exe',
        _ => '',
      };
}

/// Status category for [Resolution].
enum Status { ok, okWithWarning, deferred, prompt, error }

/// Warning codes.
enum WarningCode { envVersionMismatch, bundledVersionDrift }

/// Error codes.
enum ErrorCode { userSettingVersionMismatch, noSourceResolved, binaryNameMismatch }

/// Deferred check kinds.
enum DeferredCheck { lspInitialize }

/// Probe function signature: given a path, return `(name, version)` if the
/// binary reports them via `--version`, or `null` if it does not exist.
typedef Probe = ProbedVersion? Function(String path);

/// Probe result.
class ProbedVersion {
  const ProbedVersion(this.name, this.version);
  final String name;
  final String version;
}

/// Env-var names this component consults.
class EnvConfig {
  const EnvConfig({this.pathVar, this.dirVar});
  final String? pathVar;
  final String? dirVar;
}

/// Package-manager install targets for the `pkgmgr` source.
class PkgmgrConfig {
  const PkgmgrConfig({this.brew, this.scoop, this.apt, this.winget});
  final String? brew;
  final String? scoop;
  final String? apt;
  final String? winget;
}

/// `dotnet tool` metadata.
class DotnetToolConfig {
  const DotnetToolConfig({required this.package, this.command});
  final String package;
  final String? command;
}

/// Runtime input to [resolve].
class ResolveInput {
  const ResolveInput({
    required this.binaryName,
    required this.expectedVersion,
    required this.sources,
    this.expectedName,
    this.platform = Platform.darwinArm64,
    this.userSettingPath,
    this.env = const <String, String>{},
    this.envConfig = const EnvConfig(),
    this.pathEntries = const <String>[],
    this.bundledDir,
    this.cargoBin,
    this.pkgmgr,
    this.dotnetTool,
  });

  final String binaryName;
  final String? expectedName;
  final String expectedVersion;
  final List<Source> sources;
  final Platform platform;
  final String? userSettingPath;
  final Map<String, String> env;
  final EnvConfig envConfig;
  final List<String> pathEntries;
  final String? bundledDir;
  final String? cargoBin;
  final PkgmgrConfig? pkgmgr;
  final DotnetToolConfig? dotnetTool;
}

/// Prompt payloads returned when [Status.prompt].
sealed class PromptAction {
  const PromptAction();
  Map<String, dynamic> toJson();
}

class PkgmgrInstall extends PromptAction {
  const PkgmgrInstall(this.commands);
  final Map<String, String> commands;
  @override
  Map<String, dynamic> toJson() => {
        'kind': 'pkgmgr-install',
        'commands': commands,
      };
}

class DotnetToolUpdate extends PromptAction {
  const DotnetToolUpdate(this.command);
  final String command;
  @override
  Map<String, dynamic> toJson() => {
        'kind': 'dotnet-tool-update',
        'command': command,
      };
}

/// Resolver output.
class Resolution {
  const Resolution({
    required this.status,
    this.source,
    this.path,
    this.version,
    this.warningCode,
    this.errorCode,
    this.errorDetails,
    this.action,
    this.deferredCheck,
  });

  final Source? source;
  final String? path;
  final String? version;
  final Status status;
  final WarningCode? warningCode;
  final ErrorCode? errorCode;
  final Map<String, String>? errorDetails;
  final PromptAction? action;
  final DeferredCheck? deferredCheck;

  static Resolution ok(Source source, String path, String version) =>
      Resolution(status: Status.ok, source: source, path: path, version: version);

  static Resolution okWarn(
    Source source,
    String path,
    String version,
    WarningCode code,
  ) =>
      Resolution(
        status: Status.okWithWarning,
        source: source,
        path: path,
        version: version,
        warningCode: code,
      );

  static Resolution error(ErrorCode code, {Map<String, String>? details}) =>
      Resolution(status: Status.error, errorCode: code, errorDetails: details);

  static Resolution prompt(PromptAction action) =>
      Resolution(status: Status.prompt, action: action);

  static Resolution deferred(Source source, String path, DeferredCheck check) =>
      Resolution(
        status: Status.deferred,
        source: source,
        path: path,
        deferredCheck: check,
      );
}

/// Resolver entry point. See `schemas/test-vectors.json` for conformance.
Resolution resolve(ResolveInput input, Probe probe) {
  for (final source in input.sources) {
    final r = _trySource(source, input, probe);
    if (r != null) return r;
  }
  return Resolution.error(ErrorCode.noSourceResolved);
}

Resolution? _trySource(Source source, ResolveInput input, Probe probe) {
  switch (source) {
    case Source.userSetting:
      return _tryUserSetting(input, probe);
    case Source.env:
      return _tryEnv(input, probe);
    case Source.path:
      return _tryPath(input, probe);
    case Source.bundled:
      return _tryBundled(input, probe);
    case Source.cargoBin:
      final p = input.cargoBin;
      if (p == null) return null;
      return Resolution.deferred(Source.cargoBin, p, DeferredCheck.lspInitialize);
    case Source.pkgmgr:
      final p = input.pkgmgr;
      if (p == null) return null;
      return Resolution.prompt(PkgmgrInstall(_pkgmgrCommands(p)));
    case Source.dotnetTool:
      return _tryDotnetTool(input, probe);
    case Source.npmGlobal:
    case Source.githubRelease:
    case Source.lspInitialize:
      return null;
  }
}

Resolution? _tryUserSetting(ResolveInput input, Probe probe) {
  final path = input.userSettingPath;
  if (path == null) return null;
  final got = probe(path);
  if (got == null) {
    return Resolution.error(
      ErrorCode.userSettingVersionMismatch,
      details: {
        'expected': input.expectedVersion,
        'found': '',
        'at': path,
      },
    );
  }
  if (!_nameMatches(input, got)) {
    return Resolution.error(ErrorCode.binaryNameMismatch);
  }
  if (got.version == input.expectedVersion) {
    return Resolution.ok(Source.userSetting, path, got.version);
  }
  return Resolution.error(
    ErrorCode.userSettingVersionMismatch,
    details: {
      'expected': input.expectedVersion,
      'found': got.version,
      'at': path,
    },
  );
}

Resolution? _tryEnv(ResolveInput input, Probe probe) {
  final path = _envPath(input);
  if (path == null) return null;
  final got = probe(path);
  if (got == null) return null;
  if (!_nameMatches(input, got)) {
    return Resolution.error(ErrorCode.binaryNameMismatch);
  }
  if (got.version == input.expectedVersion) {
    return Resolution.ok(Source.env, path, got.version);
  }
  return Resolution.okWarn(Source.env, path, got.version, WarningCode.envVersionMismatch);
}

Resolution? _tryPath(ResolveInput input, Probe probe) {
  for (final entry in input.pathEntries) {
    final candidate = _joinBinary(entry, input.binaryName, input.platform);
    final got = probe(candidate);
    if (got == null) continue;
    if (!_nameMatches(input, got)) {
      return Resolution.error(ErrorCode.binaryNameMismatch);
    }
    if (got.version == input.expectedVersion) {
      return Resolution.ok(Source.path, candidate, got.version);
    }
  }
  return null;
}

Resolution? _tryBundled(ResolveInput input, Probe probe) {
  final dir = input.bundledDir;
  if (dir == null) return null;
  final candidate = _joinBinary(dir, input.binaryName, input.platform);
  final got = probe(candidate);
  if (got == null) return null;
  if (!_nameMatches(input, got)) {
    return Resolution.error(ErrorCode.binaryNameMismatch);
  }
  if (got.version == input.expectedVersion) {
    return Resolution.ok(Source.bundled, candidate, got.version);
  }
  return Resolution.okWarn(
    Source.bundled,
    candidate,
    got.version,
    WarningCode.bundledVersionDrift,
  );
}

Resolution? _tryDotnetTool(ResolveInput input, Probe probe) {
  final dt = input.dotnetTool;
  if (dt == null) return null;
  final cmd = dt.command ?? dt.package;
  final got = probe(cmd);
  if (got != null && got.version == input.expectedVersion) {
    return Resolution.ok(Source.dotnetTool, cmd, got.version);
  }
  if (got != null) {
    return Resolution.prompt(DotnetToolUpdate(
      'dotnet tool update -g ${dt.package} --version ${input.expectedVersion}',
    ));
  }
  return Resolution.prompt(DotnetToolUpdate(
    'dotnet tool install -g ${dt.package} --version ${input.expectedVersion}',
  ));
}

bool _nameMatches(ResolveInput input, ProbedVersion probed) =>
    probed.name == (input.expectedName ?? input.binaryName);

String? _envPath(ResolveInput input) {
  final pv = input.envConfig.pathVar;
  if (pv != null) {
    final v = input.env[pv];
    if (v != null) return v;
  }
  final dv = input.envConfig.dirVar;
  if (dv != null) {
    final d = input.env[dv];
    if (d != null) return _joinBinary(d, input.binaryName, input.platform);
  }
  return null;
}

String _joinBinary(String dir, String name, Platform platform) {
  var trimmed = dir;
  while (trimmed.endsWith('/') || trimmed.endsWith(r'\')) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  return '$trimmed/$name${platform.exeSuffix}';
}

Map<String, String> _pkgmgrCommands(PkgmgrConfig pkg) {
  final out = <String, String>{};
  final b = pkg.brew;
  if (b != null) {
    for (final p in const ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
      out[p] = 'brew install $b';
    }
  }
  final s = pkg.scoop;
  if (s != null) {
    out['win32-x64'] = 'scoop install $s';
    out['win32-arm64'] = 'scoop install $s';
  }
  return out;
}
