export class RehearsalInvariantError extends Error {
  readonly code: string;
  constructor(options: { readonly code: string; readonly cause?: unknown });
  toJSON(): { readonly name: string; readonly code: string };
}

export function resolveSessionSystemRehearsalSourceDataDir(
  env?: Readonly<Record<string, string | undefined>>,
): string;
export function assertContainedSourcePath(sourceDataDir: string, candidate: string): string;
export interface RehearsalArtifact {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly sha256?: string;
}
export function inventoryAllowlistedArtifacts(options: {
  readonly sourceDataDir: string;
  readonly nativeCandidates?: readonly { readonly kind: string; readonly dbPath: string }[];
}): Promise<readonly RehearsalArtifact[]>;
export function fingerprintAllowlistedArtifacts(options: {
  readonly sourceDataDir: string;
  readonly nativeCandidates?: readonly { readonly kind: string; readonly dbPath: string }[];
}): Promise<{ readonly artifactCount: number; readonly digest: string }>;
export function cloneAllowlistedArtifacts(options: {
  readonly sourceDataDir: string;
  readonly nativeCandidates?: readonly { readonly kind: string; readonly dbPath: string }[];
}): Promise<{
  readonly dataDir: string;
  readonly artifacts: readonly RehearsalArtifact[];
  readonly sourceFingerprint: Record<string, unknown>;
  readonly cleanup: () => Promise<void>;
}>;
export function runSessionSystemRepositoryRealDataRehearsal(options: any): Promise<{
  readonly success: true;
  readonly invariants: readonly { readonly code: string; readonly pass: boolean }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly versions: Readonly<Record<string, unknown>>;
  readonly digests: Readonly<Record<string, string>>;
}>;
