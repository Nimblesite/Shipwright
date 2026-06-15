/// Pure resolver: no I/O, caller supplies `probe`.
library;

/// Ordered discovery sources declared in `shipwright.schema.json`.
enum Source {
  /// User-configured binary path.
  userSetting,

  /// Environment variable source.
  env,

  /// PATH search source.
  path,

  /// Bundled binary source.
  bundled,

  /// Package-manager installation source.
  pkgmgr,

  /// .NET global tool source.
  dotnetTool,

  /// Global npm installation source.
  npmGlobal,

  /// Cargo bin installation source.
  cargoBin,

  /// GitHub release source.
  githubRelease,

  /// Language Server Protocol initialize source.
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
  /// macOS on ARM64.
  darwinArm64,

  /// macOS on x64.
  darwinX64,

  /// Linux on x64.
  linuxX64,

  /// Linux on ARM64.
  linuxArm64,

  /// Windows on x64.
  win32X64,

  /// Windows on ARM64.
  win32Arm64,

  /// Platform-independent source.
  all;

  /// Kebab-case serialization used in manifests and test vectors.
  String get wire => switch (this) {
        Platform.darwinArm64 => 'darwin-arm64',
        Platform.darwinX64 => 'darwin-x64',
        Platform.linuxX64 => 'linux-x64',
        Platform.linuxArm64 => 'linux-arm64',
        Platform.win32X64 => 'win32-x64',
        Platform.win32Arm64 => 'win32-arm64',
        Platform.all => 'all',
      };

  /// Platform-native path separator.
  String get separator => switch (this) {
        Platform.win32X64 || Platform.win32Arm64 => r'\',
        _ => '/',
      };

  /// Windows platforms append `.exe`; everything else appends nothing.
  String get exeSuffix => switch (this) {
        Platform.win32X64 || Platform.win32Arm64 => '.exe',
        _ => '',
      };
}

/// Status category for [Resolution].
enum Status {
  /// Resolution succeeded without warnings.
  ok,

  /// Resolution succeeded with a non-fatal warning.
  okWithWarning,

  /// Resolution is deferred until the caller can run a protocol check.
  deferred,

  /// User input is required before resolution can continue.
  prompt,

  /// Resolution failed.
  error;

  /// Kebab-case serialization used in manifests and test vectors.
  String get wire => switch (this) {
        Status.ok => 'ok',
        Status.okWithWarning => 'ok-with-warning',
        Status.deferred => 'deferred',
        Status.prompt => 'prompt',
        Status.error => 'error',
      };
}

/// Warning codes.
enum WarningCode {
  /// Environment binary version does not match the expected version.
  envVersionMismatch,

  /// Bundled binary version does not match the expected version.
  bundledVersionDrift;

  /// Kebab-case serialization used in manifests and test vectors.
  String get wire => switch (this) {
        WarningCode.envVersionMismatch => 'env-version-mismatch',
        WarningCode.bundledVersionDrift => 'bundled-version-drift',
      };
}

/// Error codes.
enum ErrorCode {
  /// User-configured binary exists but does not match the expected version.
  userSettingVersionMismatch,

  /// No configured source resolved to a usable binary.
  noSourceResolved,

  /// Binary reported a different product name than expected.
  binaryNameMismatch;

  /// Kebab-case serialization used in manifests and test vectors.
  String get wire => switch (this) {
        ErrorCode.userSettingVersionMismatch => 'user-setting-version-mismatch',
        ErrorCode.noSourceResolved => 'no-source-resolved',
        ErrorCode.binaryNameMismatch => 'binary-name-mismatch',
      };
}

/// Deferred check kinds.
enum DeferredCheck {
  /// Run the Language Server Protocol initialize handshake.
  lspInitialize
}

/// Probe function signature: given a path, return `(name, version)` if the
/// binary reports them via `--version`, or `null` if it does not exist.
typedef Probe = ProbedVersion? Function(String path);

/// Probe result.
class ProbedVersion {
  /// Create a probe result.
  const ProbedVersion(this.name, this.version);

  /// Binary name reported by the probe.
  final String name;

  /// Binary version reported by the probe.
  final String version;
}

/// Env-var names this component consults.
class EnvConfig {
  /// Create environment-variable resolver configuration.
  const EnvConfig({this.pathVar, this.dirVar});

  /// Environment variable that points directly to the binary path.
  final String? pathVar;

  /// Environment variable that points to the binary directory.
  final String? dirVar;
}

/// Package-manager install targets for the `pkgmgr` source.
class PkgmgrConfig {
  /// Create package-manager resolver configuration.
  const PkgmgrConfig({this.brew, this.scoop, this.apt, this.winget});

  /// Homebrew package name.
  final String? brew;

  /// Scoop package name.
  final String? scoop;

  /// Apt package name.
  final String? apt;

  /// Winget package name.
  final String? winget;
}

/// `dotnet tool` metadata.
class DotnetToolConfig {
  /// Create .NET tool resolver configuration.
  const DotnetToolConfig({required this.package, this.command});

  /// .NET tool package id.
  final String package;

  /// Optional command name when it differs from [package].
  final String? command;
}

/// Runtime input to [resolve].
class ResolveInput {
  /// Create resolver input.
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

  /// Binary name to resolve.
  final String binaryName;

  /// Optional probed product name override.
  final String? expectedName;

  /// Expected semantic version.
  final String expectedVersion;

  /// Ordered sources to try.
  final List<Source> sources;

  /// Target platform used for binary suffixes.
  final Platform platform;

  /// User-configured binary path.
  final String? userSettingPath;

  /// Environment variables available to the resolver.
  final Map<String, String> env;

  /// Environment variable configuration.
  final EnvConfig envConfig;

  /// Directories searched for [Source.path].
  final List<String> pathEntries;

  /// Bundled binary directory.
  final String? bundledDir;

  /// Cargo bin directory.
  final String? cargoBin;

  /// Package-manager source configuration.
  final PkgmgrConfig? pkgmgr;

  /// .NET tool source configuration.
  final DotnetToolConfig? dotnetTool;
}

/// Prompt payloads returned when [Status.prompt].
sealed class PromptAction {
  const PromptAction();

  /// Serialize the prompt action.
  Map<String, dynamic> toJson();
}

/// Package-manager installation prompt.
class PkgmgrInstall extends PromptAction {
  /// Create a package-manager installation prompt.
  const PkgmgrInstall(this.commands);

  /// Install commands by platform.
  final Map<String, String> commands;

  @override
  Map<String, dynamic> toJson() => {
        'kind': 'pkgmgr-install',
        'commands': commands,
      };
}

/// .NET tool update or install prompt.
class DotnetToolUpdate extends PromptAction {
  /// Create a .NET tool prompt.
  const DotnetToolUpdate(this.command);

  /// Command the caller should ask the user to run.
  final String command;

  @override
  Map<String, dynamic> toJson() => {
        'kind': 'dotnet-tool-update',
        'command': command,
      };
}

/// Resolver output.
class Resolution {
  /// Create a resolver output.
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

  /// Successful resolution.
  const Resolution.ok(Source source, String path, String version)
      : this(
          status: Status.ok,
          source: source,
          path: path,
          version: version,
        );

  /// Successful resolution with a warning.
  const Resolution.okWarn(
    Source source,
    String path,
    String version,
    WarningCode code,
  ) : this(
          status: Status.okWithWarning,
          source: source,
          path: path,
          version: version,
          warningCode: code,
        );

  /// Failed resolution.
  const Resolution.error(ErrorCode code, {Map<String, String>? details})
      : this(
          status: Status.error,
          errorCode: code,
          errorDetails: details,
        );

  /// Resolution that requires a prompt.
  const Resolution.prompt(PromptAction action)
      : this(status: Status.prompt, action: action);

  /// Resolution deferred to a later protocol check.
  const Resolution.deferred(
    Source source,
    String path,
    DeferredCheck check,
  ) : this(
          status: Status.deferred,
          source: source,
          path: path,
          deferredCheck: check,
        );

  /// Source that produced the resolution.
  final Source? source;

  /// Resolved binary path or command.
  final String? path;

  /// Resolved binary version.
  final String? version;

  /// Resolution status.
  final Status status;

  /// Warning code when [status] is [Status.okWithWarning].
  final WarningCode? warningCode;

  /// Error code when [status] is [Status.error].
  final ErrorCode? errorCode;

  /// Extra error details for callers.
  final Map<String, String>? errorDetails;

  /// Prompt action when [status] is [Status.prompt].
  final PromptAction? action;

  /// Deferred check when [status] is [Status.deferred].
  final DeferredCheck? deferredCheck;
}

/// Resolver entry point. See `schemas/test-vectors.json` for conformance.
Resolution resolve(ResolveInput input, Probe probe) {
  for (final source in input.sources) {
    final r = _trySource(source, input, probe);
    if (r != null) return r;
  }
  return const Resolution.error(ErrorCode.noSourceResolved);
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
      return Resolution.deferred(
        Source.cargoBin,
        p,
        DeferredCheck.lspInitialize,
      );
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
    return const Resolution.error(ErrorCode.binaryNameMismatch);
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
    return const Resolution.error(ErrorCode.binaryNameMismatch);
  }
  if (got.version == input.expectedVersion) {
    return Resolution.ok(Source.env, path, got.version);
  }
  return Resolution.okWarn(
    Source.env,
    path,
    got.version,
    WarningCode.envVersionMismatch,
  );
}

Resolution? _tryPath(ResolveInput input, Probe probe) {
  for (final entry in input.pathEntries) {
    final candidate = _joinBinary(entry, input.binaryName, input.platform);
    final got = probe(candidate);
    if (got == null) continue;
    if (!_nameMatches(input, got)) {
      return const Resolution.error(ErrorCode.binaryNameMismatch);
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
    return const Resolution.error(ErrorCode.binaryNameMismatch);
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
    return Resolution.prompt(
      DotnetToolUpdate(
        'dotnet tool update -g ${dt.package} '
        '--version ${input.expectedVersion}',
      ),
    );
  }
  return Resolution.prompt(
    DotnetToolUpdate(
      'dotnet tool install -g ${dt.package} --version ${input.expectedVersion}',
    ),
  );
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
  return '$trimmed${platform.separator}$name${platform.exeSuffix}';
}

Map<String, String> _pkgmgrCommands(PkgmgrConfig pkg) {
  final out = <String, String>{};
  final b = pkg.brew;
  if (b != null) {
    for (final p in const [
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'linux-arm64',
    ]) {
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
