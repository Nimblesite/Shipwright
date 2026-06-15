export type {
  ActivateShipwrightOptions,
  ActivationDiagnostic,
  ActivationResult,
  DeploymentManifest,
  ExtensionContextLike,
  HostPolicy,
  ManifestComponent,
  VscodeApiLike,
} from "./activate.js";
export { activateShipwright, detectPlatform, loadShipwrightManifest } from "./activate.js";
export type {
  ExecFile,
  ExecFileCallback,
  ExecFileError,
  ExecFileOptions,
  ProbeBinaryVersionOptions,
  ProbeFailure,
  ProbeFailureReason,
  ProbeResult,
} from "./probe.js";
export { parseVersionOutput, probeBinaryVersion, probeBinaryVersionResult } from "./probe.js";
