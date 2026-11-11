// Generate TypeScript data structures (enums + interfaces) from the thrift IDL.
//
// We feed the IDL through @creditkarma/thrift-typescript to obtain the canonical
// shape (numeric enums + IXxx interfaces) and then post-process the TS source to
// keep only the data definitions, dropping the Codec / IXxxArgs / service /
// thrift binary protocol glue so the @mavis/protocol package stays runtime-dep
// free. Wire format is plain JSON of these structures (numeric enums + raw
// objects); consumers must adapt accordingly.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScanner, make, SyntaxType } from '@creditkarma/thrift-typescript';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_ROOT = resolve(__dirname, '..');
// IDL 真值源是 weaver 仓库 (matrix/archon_server),通过相对路径取。
// agent-archon 跟 weaver 是兄弟仓库目录关系:
//   <git-root>/matrix/agent-archon/packages/protocol/scripts/
//   <git-root>/weaver/idl/matrix/archon_server/
// 从 PROTOCOL_ROOT (packages/protocol) 向上 4 层到 git-root,再走 weaver/idl/...。
//
// Worktree / 自定义路径覆盖:`IDL_PATH=/abs/path/to/archon_protocol.thrift pnpm gen:ts`。
// agent-archon `.worktrees/` 下的 worktree 比 main checkout 深 2 层(`.worktrees/<name>`),
// 相对路径解析跑偏。CI / 主仓库正常路径仍走默认 fallback。
const IDL_PATH =
  process.env.IDL_PATH ??
  resolve(PROTOCOL_ROOT, '../../../../weaver/idl/matrix/archon_server/archon_protocol.thrift');
const SERVER_IDL_PATH = resolve(dirname(IDL_PATH), 'archon_server.thrift');
const OUTPUT_PATH = resolve(PROTOCOL_ROOT, 'src/generated/archon_protocol.ts');

// SafetyAction belongs to Check in archon_server.thrift. Scan only its declaration:
// unrelated server APIs/includes are not inputs to this runtime data generator.
// Tokens keep braces inside comments from truncating the declaration.
function extractSafetyAction(source: string): string {
  const tokens = createScanner(source, (error) => {
    throw new Error(`Cannot scan ${SERVER_IDL_PATH}: ${error.message}`);
  })
    .scan()
    .filter(
      (token) => token.type !== SyntaxType.CommentLine && token.type !== SyntaxType.CommentBlock,
    );
  const declarations = tokens.filter(
    (token, index) =>
      token.type === SyntaxType.EnumKeyword && tokens[index + 1]?.text === 'SafetyAction',
  );
  if (declarations.length !== 1) {
    throw new Error(`Expected one SafetyAction enum in ${SERVER_IDL_PATH}`);
  }
  const start = tokens.indexOf(declarations[0]);
  if (tokens[start + 2]?.type !== SyntaxType.LeftBraceToken) {
    throw new Error(`Invalid SafetyAction enum in ${SERVER_IDL_PATH}`);
  }
  const end = tokens.slice(start + 3).find((token) => token.type === SyntaxType.RightBraceToken);
  if (!end) throw new Error(`Unterminated SafetyAction enum in ${SERVER_IDL_PATH}`);
  return source.slice(declarations[0].loc.start.index, end.loc.end.index);
}

// `base_rpc.BaseResp` is declared in a sibling weaver/idl tree we cannot resolve
// from a single-file `make()` call. Replace the import with an inline stub so
// thrift-typescript produces a local IBaseResp shape; we re-export it later.
const BASE_RESP_STUB = `
struct BaseResp {
    1: optional i32 status_code,
    2: optional string status_msg,
    3: optional map<string, string> trace_info,
    4: optional string trace_info_str,
}
`;

// archon_protocol references api_common/plugin.thrift for both the per-turn
// PluginRef and ToolCall Plugin provenance. The single-file generator
// deliberately strips includes, so keep the consumed wire shapes inline just
// as we already do for BaseResp.
const PLUGIN_STUB = `
enum InstalledPluginSource {
    OFFICIAL = 1,
    LOCAL = 2,
}

enum PluginCapabilityType {
    APP = 1,
    MCP = 2,
    SKILL = 3,
}
struct PluginRef {
    1: required string name,
    2: required string version,
    3: required string data_oss_key,
    4: required string archive_sha256,
    5: required string content_digest,
    6: optional string icon_url,
    7: optional string dark_icon_url,
}


struct PluginCapabilityProvenance {
    1: required string plugin_name,
    2: optional string plugin_version,
    3: required InstalledPluginSource source,
    4: required PluginCapabilityType capability_type,
    5: required string capability_name,
    6: optional string icon_url,
    7: optional string dark_icon_url,
}
`;

function preprocessThrift(source: string, safetyAction: string): string {
  return (
    source
      .replace(/^include\s+"[^"]+"\s*$/gm, '// stripped include for single-file make()')
      .replace(/base_rpc\.BaseResp/g, 'BaseResp')
      .replace(/plugin\.PluginRef/g, 'PluginRef')
      .replace(/plugin\.PluginCapabilityProvenance/g, 'PluginCapabilityProvenance')
      // `required` is a valid JSON field name but a thrift grammar keyword.
      // Rename the one wire field while parsing, then restore it in the emitted
      // TypeScript interface below.
      .replace(/(\d+:\s+required\s+bool\s+)required([,;]?)/g, '$1required_field$2')
      .replace(/(namespace\s+go[^\n]+)/, `$1\n${BASE_RESP_STUB}\n${PLUGIN_STUB}\n${safetyAction}`)
  );
}

function isDataInterface(name: string): boolean {
  // thrift-server emits IXxx (strict) and IXxxArgs (loose input). Keep only the
  // strict variant — wire shape is JSON of the struct, not the codec input.
  if (name.endsWith('Args')) return false;
  // Service-handler scaffolding (IXxx__Result, IHandler) leaks out of namespace
  // declarations; drop it since we only ship data shapes.
  if (name.endsWith('__Result')) return false;
  if (name === 'IHandler') return false;
  return true;
}

function rewriteThriftInt64(node: ts.TypeNode): ts.TypeNode {
  // thrift-server emits `thrift.Int64` for i64 fields. Wire is JSON, and the
  // existing pipeline normalises i64 either as plain number (when small) or as
  // a decimal string (snowflake). Use `number | string` so both shapes type
  // through without a runtime cast at the boundary.
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isQualifiedName(node.typeName) &&
    ts.isIdentifier(node.typeName.left) &&
    node.typeName.left.text === 'thrift' &&
    node.typeName.right.text === 'Int64'
  ) {
    return ts.factory.createUnionTypeNode([
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    ]);
  }
  return node;
}

function rewriteMapToRecord(node: ts.TypeNode): ts.TypeNode {
  // thrift map<K, V> → JS Map<K, V> in thrift-typescript output; we want plain
  // Record<K, V> so JSON.stringify produces an object on the wire.
  const int64Rewritten = rewriteThriftInt64(node);
  if (int64Rewritten !== node) return int64Rewritten;
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'Map' &&
    node.typeArguments?.length === 2
  ) {
    return ts.factory.createTypeReferenceNode('Record', [
      rewriteMapToRecord(node.typeArguments[0]),
      rewriteMapToRecord(node.typeArguments[1]),
    ]);
  }
  if (ts.isArrayTypeNode(node)) {
    return ts.factory.createArrayTypeNode(rewriteMapToRecord(node.elementType));
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments) {
    return ts.factory.createTypeReferenceNode(
      node.typeName,
      node.typeArguments.map(rewriteMapToRecord),
    );
  }
  if (ts.isUnionTypeNode(node)) {
    return ts.factory.createUnionTypeNode(node.types.map(rewriteMapToRecord));
  }
  return node;
}

function rewriteInterface(decl: ts.InterfaceDeclaration): ts.InterfaceDeclaration {
  const members = decl.members.map((member) => {
    if (ts.isPropertySignature(member) && member.type) {
      const name =
        ts.isIdentifier(member.name) && member.name.text === 'required_field'
          ? ts.factory.createIdentifier('required')
          : member.name;
      return ts.factory.updatePropertySignature(
        member,
        member.modifiers,
        name,
        member.questionToken,
        rewriteMapToRecord(member.type),
      );
    }
    return member;
  });
  return ts.factory.updateInterfaceDeclaration(
    decl,
    decl.modifiers,
    decl.name,
    decl.typeParameters,
    decl.heritageClauses,
    members,
  );
}

const HEADER = `/* eslint-disable */
// AUTO-GENERATED from weaver/idl/matrix/archon_server/archon_protocol.thrift
// and SafetyAction in the sibling archon_server.thrift via
// @creditkarma/thrift-typescript. Do NOT edit by hand. Run \`pnpm gen:ts\` in
// packages/protocol to regenerate.
//
// Enums follow thrift-typescript convention (numeric \`enum\`). Structs are
// emitted as plain TS interfaces (IXxx). Wire format is JSON of these shapes,
// so enum values land on the wire as numbers and \`map<K,V>\` lands as a JSON
// object (Record<K,V>).
`;

function main(): void {
  const raw = readFileSync(IDL_PATH, 'utf-8');
  const safetyAction = extractSafetyAction(readFileSync(SERVER_IDL_PATH, 'utf-8'));
  const prepped = preprocessThrift(raw, safetyAction);
  const fullOutput = make(prepped, { target: 'thrift-server' });

  const source = ts.createSourceFile('thrift-output.ts', fullOutput, ts.ScriptTarget.ES2020, true);

  const kept: ts.Statement[] = [];
  for (const stmt of source.statements) {
    if (ts.isEnumDeclaration(stmt)) {
      kept.push(stmt);
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt) && isDataInterface(stmt.name.text)) {
      kept.push(rewriteInterface(stmt));
      continue;
    }
    // drop everything else: VariableStatement (Codec), ClassDeclaration,
    // NamespaceDeclaration (services), ImportDeclaration (thrift codec),
    // IXxxArgs interfaces.
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const body = kept.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, source)).join('\n\n');

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${HEADER}\n${body}\n`, 'utf-8');
  console.log(`wrote ${OUTPUT_PATH} (${body.split('\n').length} lines)`);
}

main();
