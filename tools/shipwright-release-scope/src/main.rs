//! `shipwright-release-scope` — decide which release surfaces a `v*` tag must
//! actually publish, so the expensive multi-platform build matrix only runs when
//! the thing it builds has changed since the previous release.
//!
//! Implements `docs/specs/release-change-detection.md` [SWR-REL-CHANGES-*]
//! (the Shipwright realisation of the Deslop `SWR-REL-CHANGES` proposal).
//!
//! The tool is **pure**: it reads a newline-delimited list of changed paths and
//! a JSON ruleset, then prints a decision document to stdout. Resolving the
//! previous tag and running `git diff` is the caller's job (the reusable
//! workflow `templates/gh-actions/release-change-detection.yml`), mirroring the
//! injected-I/O design of `shipwright-host`.
//!
//! ```text
//! shipwright-release-scope --config .github/release-scope.json --changed changed.txt
//! git diff --name-only PREV..CUR | shipwright-release-scope --config rules.json --changed -
//! ```
//!
//! ## Decision rule
//!
//! Shipwright stamps **one version per tag** and every host `activation-verify`
//! is `onMismatch: error`, so any artifact that bundles a binary must bundle one
//! built at the tag version — you cannot ship a new VSIX/JetBrains plugin without
//! rebuilding its binaries. That bounds what can ship alone:
//!
//! - any **binary** path changed → full release: build matrix + every channel
//!   [SWR-REL-CHANGES-CASCADE].
//! - any **unmatched** path changed → full release, fail-safe
//!   [SWR-REL-CHANGES-FAILSAFE].
//! - **vsix** / **jetbrains** changed (binary unchanged) → the binary matrix
//!   STILL runs (the artifact bundles binaries at the new version), that artifact
//!   publishes, but unrelated channels (the standalone binary release, Homebrew,
//!   Scoop, the other extension, the website) are skipped
//!   [SWR-REL-CHANGES-MATRIX].
//! - **website** only → the one fully decoupled surface: skip the whole matrix.
//!
//! Paths are matched in fixed priority order — binary, vsix, jetbrains, website,
//! ignore — and the first category a path matches wins [SWR-REL-CHANGES-PRIORITY].
//!
//! When `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` are set (GitHub Actions), the
//! decision is also appended to those files.

#![forbid(unsafe_code)]

use glob::{MatchOptions, Pattern};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Top-level error type for the CLI.
#[derive(Debug, thiserror::Error)]
enum ScopeError {
    /// Bad or missing command-line argument.
    #[error("argument: {0}")]
    Args(String),
    /// File-system or stdin read/write error.
    #[error("io at {path}: {source}")]
    Io {
        /// Path (or `<stdin>`) where the error occurred.
        path: PathBuf,
        /// Underlying error.
        source: io::Error,
    },
    /// The ruleset file did not parse as JSON.
    #[error("config json: {0}")]
    Json(#[from] serde_json::Error),
    /// A glob in the ruleset was malformed.
    #[error("invalid glob `{glob}` in category `{category}`: {source}")]
    Glob {
        /// Ruleset category the bad glob came from.
        category: String,
        /// The offending glob string.
        glob: String,
        /// Underlying glob parse error.
        source: glob::PatternError,
    },
}

/// Glob rules that map changed paths to a release surface.
#[derive(Debug, Deserialize)]
struct Rules {
    /// Globs whose change forces a full release (native/compiled sources).
    #[serde(default)]
    binary: Vec<String>,
    /// Globs for the VS Code extension (bundles a binary).
    #[serde(default)]
    vsix: Vec<String>,
    /// Globs for the `JetBrains` plugin (bundles a binary).
    #[serde(default)]
    jetbrains: Vec<String>,
    /// Globs for the documentation website (the only decoupled surface).
    #[serde(default)]
    website: Vec<String>,
    /// Globs for paths that never trigger a release.
    #[serde(default)]
    ignore: Vec<String>,
}

/// Compiled glob patterns for every surface, in priority order.
#[derive(Debug)]
struct Matcher {
    /// Compiled `binary` globs.
    binary: Vec<Pattern>,
    /// Compiled `vsix` globs.
    vsix: Vec<Pattern>,
    /// Compiled `jetbrains` globs.
    jetbrains: Vec<Pattern>,
    /// Compiled `website` globs.
    website: Vec<Pattern>,
    /// Compiled `ignore` globs.
    ignore: Vec<Pattern>,
}

/// The surface a single changed path was classified into.
#[derive(Debug)]
enum Surface {
    /// Matched a `binary` glob.
    Binary,
    /// Matched a `vsix` glob.
    Vsix,
    /// Matched a `jetbrains` glob.
    Jetbrains,
    /// Matched a `website` glob.
    Website,
    /// Matched an `ignore` glob.
    Ignore,
    /// Matched no glob — triggers the fail-safe full release.
    Unmatched,
}

/// Per-surface lists of the changed paths that landed in each bucket.
#[derive(Debug, Serialize, Default)]
struct Classified {
    /// Paths classified as binary changes.
    binary: Vec<String>,
    /// Paths classified as vsix changes.
    vsix: Vec<String>,
    /// Paths classified as jetbrains changes.
    jetbrains: Vec<String>,
    /// Paths classified as website changes.
    website: Vec<String>,
    /// Paths explicitly ignored.
    ignored: Vec<String>,
    /// Paths that matched no rule.
    unmatched: Vec<String>,
}

/// The machine-readable release decision printed to stdout.
///
/// The booleans are the published output contract (one `$GITHUB_OUTPUT` key
/// each), not internal flags, so `struct_excessive_bools` is allowed here.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Serialize)]
struct Decision {
    /// Full release: native binary changed (or fail-safe) — publish everything.
    full: bool,
    /// The native binary build matrix must run (full, or a binary-bundling
    /// artifact changed). This is the expensive, macOS/Windows-heavy gate.
    build_matrix: bool,
    /// Publish the VS Code extension.
    vsix: bool,
    /// Publish the `JetBrains` plugin.
    jetbrains: bool,
    /// Deploy the documentation website.
    website: bool,
    /// Number of changed paths considered.
    changed_count: usize,
    /// Full per-surface classification, for auditing.
    classified: Classified,
    /// Human-readable explanation of the decision.
    reason: String,
}

/// Parsed command-line options.
#[derive(Debug)]
struct Opts {
    /// Path to the JSON ruleset.
    config: String,
    /// Path to the changed-files list, or `-` for stdin.
    changed: String,
}

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(io::stderr(), "shipwright-release-scope: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Execute the CLI: parse → load rules → classify → decide → emit.
fn run(args: Vec<String>) -> Result<(), ScopeError> {
    let Some(opts) = parse_opts(args)? else {
        print_help();
        return Ok(());
    };
    let rules = load_rules(&opts.config)?;
    let matcher = build_matcher(&rules)?;
    let changed = read_changed(&opts.changed)?;
    let decision = decide(&matcher, &changed);
    emit(&decision)
}

/// Parse `--config` and `--changed`; `--help`/`-h` short-circuits via `Ok(None)`.
fn parse_opts(args: Vec<String>) -> Result<Option<Opts>, ScopeError> {
    let mut config: Option<String> = None;
    let mut changed: Option<String> = None;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(None),
            "--config" => config = Some(next_value(&mut it, "--config")?),
            "--changed" => changed = Some(next_value(&mut it, "--changed")?),
            other => return Err(ScopeError::Args(format!("unknown argument `{other}`"))),
        }
    }
    let config = config.ok_or_else(|| ScopeError::Args("--config is required".to_owned()))?;
    let changed = changed.ok_or_else(|| ScopeError::Args("--changed is required".to_owned()))?;
    Ok(Some(Opts { config, changed }))
}

/// Pull the value following a flag, erroring if it is missing.
fn next_value(it: &mut std::vec::IntoIter<String>, flag: &str) -> Result<String, ScopeError> {
    it.next()
        .ok_or_else(|| ScopeError::Args(format!("{flag} requires a value")))
}

/// Load and parse the JSON ruleset from `path`.
fn load_rules(path: &str) -> Result<Rules, ScopeError> {
    let body = fs::read_to_string(path).map_err(|source| io_err(path, source))?;
    Ok(serde_json::from_str(&body)?)
}

/// Compile every surface's globs into priority-ordered matchers.
fn build_matcher(rules: &Rules) -> Result<Matcher, ScopeError> {
    Ok(Matcher {
        binary: compile("binary", &rules.binary)?,
        vsix: compile("vsix", &rules.vsix)?,
        jetbrains: compile("jetbrains", &rules.jetbrains)?,
        website: compile("website", &rules.website)?,
        ignore: compile("ignore", &rules.ignore)?,
    })
}

/// Compile one surface's glob strings, attributing any error to `category`.
fn compile(category: &str, globs: &[String]) -> Result<Vec<Pattern>, ScopeError> {
    globs
        .iter()
        .map(|g| {
            Pattern::new(g).map_err(|source| ScopeError::Glob {
                category: category.to_owned(),
                glob: g.clone(),
                source,
            })
        })
        .collect()
}

/// Glob match options: `*`/`?` stay within a path segment; `**` spans directories.
fn match_opts() -> MatchOptions {
    MatchOptions {
        case_sensitive: true,
        require_literal_separator: true,
        require_literal_leading_dot: false,
    }
}

/// True when `path` matches any pattern in `patterns`.
fn any_match(patterns: &[Pattern], path: &str) -> bool {
    let opts = match_opts();
    patterns.iter().any(|p| p.matches_with(path, opts))
}

/// Classify `path` into the first surface it matches, in priority order.
fn classify(m: &Matcher, path: &str) -> Surface {
    if any_match(&m.binary, path) {
        Surface::Binary
    } else if any_match(&m.vsix, path) {
        Surface::Vsix
    } else if any_match(&m.jetbrains, path) {
        Surface::Jetbrains
    } else if any_match(&m.website, path) {
        Surface::Website
    } else if any_match(&m.ignore, path) {
        Surface::Ignore
    } else {
        Surface::Unmatched
    }
}

/// Bucket every changed path into its highest-priority surface.
fn classify_all(matcher: &Matcher, changed: &[String]) -> Classified {
    let mut c = Classified::default();
    for path in changed {
        match classify(matcher, path) {
            Surface::Binary => c.binary.push(path.clone()),
            Surface::Vsix => c.vsix.push(path.clone()),
            Surface::Jetbrains => c.jetbrains.push(path.clone()),
            Surface::Website => c.website.push(path.clone()),
            Surface::Ignore => c.ignored.push(path.clone()),
            Surface::Unmatched => c.unmatched.push(path.clone()),
        }
    }
    c
}

/// Apply the cascade / matrix / fail-safe rule to a classification.
fn decide(matcher: &Matcher, changed: &[String]) -> Decision {
    let c = classify_all(matcher, changed);
    let full = !c.binary.is_empty() || !c.unmatched.is_empty();
    // A binary-bundling artifact (vsix/jetbrains) needs binaries built at the new
    // tag version, so its change forces the matrix even when binary is unchanged.
    let vsix = full || !c.vsix.is_empty();
    let jetbrains = full || !c.jetbrains.is_empty();
    let website = full || !c.website.is_empty();
    let build_matrix = full || !c.vsix.is_empty() || !c.jetbrains.is_empty();
    let reason = reason_for(&c, full);
    Decision {
        full,
        build_matrix,
        vsix,
        jetbrains,
        website,
        changed_count: changed.len(),
        classified: c,
        reason,
    }
}

/// Build the human-readable explanation for a decision.
fn reason_for(c: &Classified, full: bool) -> String {
    if full {
        return full_reason(c);
    }
    let mut surfaces: Vec<&str> = Vec::new();
    if !c.vsix.is_empty() {
        surfaces.push("vsix");
    }
    if !c.jetbrains.is_empty() {
        surfaces.push("jetbrains");
    }
    if !c.website.is_empty() {
        surfaces.push("website");
    }
    if surfaces.is_empty() {
        return "no release-relevant changes -> publish nothing".to_owned();
    }
    format!("partial release: {} changed", surfaces.join(" + "))
}

/// Reason string when a full release is forced.
fn full_reason(c: &Classified) -> String {
    if c.binary.is_empty() {
        format!(
            "{} unclassified path(s) changed -> full release, fail-safe [SWR-REL-CHANGES-FAILSAFE]",
            c.unmatched.len()
        )
    } else {
        format!(
            "{} binary path(s) changed -> full release [SWR-REL-CHANGES-CASCADE]",
            c.binary.len()
        )
    }
}

/// Read newline-delimited changed paths from a file or stdin (`-`).
fn read_changed(source: &str) -> Result<Vec<String>, ScopeError> {
    let raw = if source == "-" {
        read_stdin()?
    } else {
        fs::read_to_string(source).map_err(|e| io_err(source, e))?
    };
    Ok(parse_lines(&raw))
}

/// Read all of stdin to a string.
fn read_stdin() -> Result<String, ScopeError> {
    let mut buf = String::new();
    let _ = io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| io_err("<stdin>", e))?;
    Ok(buf)
}

/// Split raw text into trimmed, non-empty lines.
fn parse_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// Build a `ScopeError::Io` for `path`.
fn io_err(path: &str, source: io::Error) -> ScopeError {
    ScopeError::Io {
        path: PathBuf::from(path),
        source,
    }
}

/// Serialize the decision to stdout and, under GitHub Actions, to the
/// `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` files.
fn emit(decision: &Decision) -> Result<(), ScopeError> {
    let json = serde_json::to_string_pretty(decision)?;
    println!("{json}");
    if let Some(path) = std::env::var_os("GITHUB_OUTPUT") {
        append_github_output(Path::new(&path), decision)?;
    }
    if let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY") {
        append_summary(Path::new(&path), decision)?;
    }
    Ok(())
}

/// Append the boolean outputs to the `GITHUB_OUTPUT` key=value file.
fn append_github_output(path: &Path, d: &Decision) -> Result<(), ScopeError> {
    let body = format!(
        "full={}\nbuild_matrix={}\nvsix={}\njetbrains={}\nwebsite={}\n",
        d.full, d.build_matrix, d.vsix, d.jetbrains, d.website
    );
    append_file(path, &body)
}

/// Append a human-readable Markdown summary to the Actions step summary.
fn append_summary(path: &Path, d: &Decision) -> Result<(), ScopeError> {
    let body = format!(
        "### Release scope\n\n- full: `{}`\n- build_matrix: `{}`\n- vsix: `{}`\n- jetbrains: `{}`\n- website: `{}`\n\n{}\n",
        d.full, d.build_matrix, d.vsix, d.jetbrains, d.website, d.reason
    );
    append_file(path, &body)
}

/// Append `body` to the file at `path`, creating it if absent.
fn append_file(path: &Path, body: &str) -> Result<(), ScopeError> {
    append_raw(path, body).map_err(|e| ScopeError::Io {
        path: path.to_path_buf(),
        source: e,
    })
}

/// Open-append-write, surfacing the raw I/O error for the caller to wrap.
fn append_raw(path: &Path, body: &str) -> io::Result<()> {
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    f.write_all(body.as_bytes())
}

/// Print usage to stdout.
fn print_help() {
    println!(
        "shipwright-release-scope — classify changed paths into release surfaces\n\
         \n\
         USAGE:\n\
         \x20 shipwright-release-scope --config <ruleset.json> --changed <list|->\n\
         \n\
         OPTIONS:\n\
         \x20 --config <path>   JSON ruleset (schemas/release-scope.schema.json)\n\
         \x20 --changed <path>  newline-delimited changed paths, or - for stdin\n\
         \x20 -h, --help        show this help\n\
         \n\
         Prints a JSON decision to stdout and, under GitHub Actions, appends\n\
         full/build_matrix/vsix/jetbrains/website to $GITHUB_OUTPUT. See\n\
         docs/specs/release-change-detection.md [SWR-REL-CHANGES-*]."
    );
}
