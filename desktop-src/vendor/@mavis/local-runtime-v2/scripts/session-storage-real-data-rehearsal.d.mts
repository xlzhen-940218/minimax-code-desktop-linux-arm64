export class RehearsalInvariantError extends Error {
  readonly code: string;
  readonly table?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly rowKey?: string;
  constructor(options: {
    readonly code: string;
    readonly table?: string;
    readonly expected?: unknown;
    readonly actual?: unknown;
    readonly rowKey?: string;
    readonly cause?: unknown;
  });
  toJSON(): Record<string, unknown>;
}

export function resolveRehearsalSourceDataDir(
  env?: Readonly<Record<string, string | undefined>>,
): string;
export function redactedRowKey(value: unknown, salt: string): string;
export function fingerprintSourceDatabase(dataDir: string): Promise<Record<string, unknown>>;
export function createReadOnlyDatabaseSnapshot(options: {
  readonly sourceDataDir: string;
}): Promise<{
  readonly dataDir: string;
  readonly databasePath: string;
  readonly sourceFingerprint: Record<string, unknown>;
  readonly cleanup: () => Promise<void>;
}>;

// The verifier is a native ESM test harness shared with Node and Electron scripts.
// Its SQLite and production-module inputs intentionally remain structurally open here.
export function captureLogicalSnapshot(database: any, selectedTables?: readonly string[]): any;
export function captureSessionCreateBefore(database: any): any;
export function verifySessionCreate(
  before: any,
  database: any,
  options: { readonly assertSchemaConsistent: (database: any) => void },
): void;
export function captureSessionBackfillBefore(database: any): any;
export function verifySessionBackfill(
  before: any,
  database: any,
  options: { readonly assertSchemaConsistent: (database: any) => void },
): void;
export function captureIngressNormalizeBefore(database: any): any;
export function verifyIngressNormalize(before: any, database: any): void;
export function runSessionStorageRealDataRehearsal(options: any): Promise<any>;
export function runStepwiseRehearsal(options: any): Promise<any>;
export function runProductionInitializeRehearsal(options: any): Promise<any>;
export function assertSourceMigrationPreconditions(
  database: any,
  assertSchemaConsistent?: (database: any) => void,
): readonly number[];
export function inspectFinalSessionStorageDatabase(options: any): any;
export function readRehearsalSourceSelection(databasePath: string): any;
export function captureSelectedMigrationState(databaseOrPath: any, selection: any): any;
