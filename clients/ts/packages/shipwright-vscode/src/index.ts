export type {
  ActivateShipwrightOptions,
  ActivationDiagnostic,
  ActivationResult,
  DeploymentManifest,
  ExtensionContextLike,
  HostPolicy,
  ManifestComponent,
  VscodeApiLike
} from "./activate.js";
export { activateShipwright, detectPlatform, loadShipwrightManifest } from "./activate.js";
export type { ExecFile, ExecFileCallback, ExecFileError, ExecFileOptions, ProbeBinaryVersionOptions } from "./probe.js";
export { parseVersionOutput, probeBinaryVersion } from "./probe.js";
