const v1RuntimeWorkspaceImplementationPaths = [
  String.raw`^packages/local-runtime/(?:dist|src)(?:/|$)`,
  String.raw`^(?:\.\./)+local-runtime/(?:dist|src)(?:/|$)`,
];

const v1RuntimeDependencyPaths = [
  String.raw`^@mavis/local-runtime(?:/|$)`,
  String.raw`(?:^|/)node_modules/@mavis/local-runtime(?:/|$)`,
  ...v1RuntimeWorkspaceImplementationPaths,
];

const v1RuntimeResolvedBoundaryPaths = [
  String.raw`(?:^|/)node_modules/@mavis/local-runtime/(?:dist|src)(?:/|$)`,
  ...v1RuntimeWorkspaceImplementationPaths,
];

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'production-no-test-import',
      comment: 'Production source must not depend on colocated test modules.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`\.test\.ts$` },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolved',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'service-consumers-via-index',
      comment:
        'Production consumers outside a service use its root index barrel instead of deep-importing implementation files.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!service/)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/service/[^/]+/(?!index\.ts$)`,
      },
    },
    {
      name: 'application-no-http-hono-or-infra',
      comment:
        'Application owns contract mapping and workflows without depending on HTTP/local delivery or concrete infrastructure.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/application/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: [
          String.raw`(?:^|/)src/(?:http|local|infra)/`,
          String.raw`^hono(?:/|$)`,
          String.raw`(?:^|/)node_modules/hono(?:/|$)`,
        ],
      },
    },
    {
      name: 'application-compat-via-runtime-or-session',
      comment:
        'Application may consume only the aggregate runtime compatibility contract or the narrow Session compatibility port.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/application/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/compat/`,
        pathNot: String.raw`(?:^|/)src/compat/v1/(?:runtime|session)\.ts$`,
      },
    },
    {
      name: 'service-no-application',
      comment: 'Services remain transport- and workflow-independent Application dependencies.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/application/` },
    },
    {
      name: 'turn-system-no-queue-persistence',
      comment:
        'Turn System coordinates Queue through Session System capabilities and must not import Queue repositories or schema.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: [
          String.raw`(?:^|/)src/service/session-system/queue/repo/`,
          String.raw`(?:^|/)src/infra/db/schema/queue\.ts$`,
        ],
      },
    },
    {
      name: 'domain-no-http',
      comment: 'Future domain modules must not depend on the HTTP delivery boundary.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!http(?:/|$)|index\.ts$|runtime\.ts$)[^/]+/`,
      },
      to: { path: String.raw`(?:^|/)src/http/` },
    },
    {
      name: 'infra-no-service',
      comment: 'Infrastructure capabilities must not import business services.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/infra/` },
      to: { path: String.raw`(?:^|/)src/service/` },
    },
    {
      name: 'model-system-no-turn-system',
      comment:
        'ModelSystem is a sibling service and must remain independent from TurnSystem orchestration.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/model-system/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/service/turn-system/`,
      },
    },
    {
      name: 'agent-host-session-system-contract-type-only',
      comment:
        'AgentHost receives SessionSystem through dependency injection and may only import its exact public contract as a type.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/service/session-system/index\.ts$`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'agent-host-orchestration-core-self-contained',
      comment:
        'AgentHost orchestration core depends on agent-runtime, agent-core, plugin-hooks, its own module, and exact SessionSystem/content-safety public entrypoints.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/`,
        pathNot: [
          String.raw`(?:^|/)src/service/turn-system/agent-host/history/incremental-sha256\.ts$`,
          String.raw`(?:^|/)src/service/turn-system/agent-host/history/semantic-identity\.ts$`,
          String.raw`\.test\.ts$`,
          String.raw`(?:^|/)src/service/turn-system/agent-host/(?:assembly/(?:local-turn-(?:tool|plugin|payload-transform)|messages-file-api-patcher\.ts$)|preparation/|runner/|tools/|native-production-dependencies\.ts$)`,
        ],
      },
      to: {
        pathNot: [
          String.raw`(?:^|/)src/service/turn-system/agent-host/`,
          String.raw`(?:^|/)src/service/session-system/index\.ts$`,
          String.raw`(?:^|/)src/service/content-safety/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/agent-(?:core|runtime)(?:/|$)`,
          String.raw`(?:^|/)node_modules/@mavis/plugin-hooks(?:/|$)`,
          String.raw`(?:^|/)node_modules/@mavis/conversation-contract/src/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/keyed-operation-lane\.ts$`,
        ],
      },
    },
    {
      name: 'agent-host-semantic-hash-native-crypto-only',
      comment:
        'The semantic SHA-256 leaf may use native crypto for bounded hashing; other orchestration modules retain the platform boundary.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/history/incremental-sha256\.ts$`,
      },
      to: { pathNot: String.raw`^(?:node:)?crypto$` },
    },
    {
      name: 'agent-host-semantic-snapshot-native-util-only',
      comment:
        'Owned snapshot cloning uses native proxy detection without executing untrusted traps; no I/O dependencies are allowed.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/history/semantic-identity\.ts$`,
      },
      to: {
        pathNot: [
          String.raw`^(?:node:)?util$`,
          String.raw`(?:^|/)src/service/turn-system/agent-host/history/incremental-sha256\.ts$`,
        ],
      },
    },
    {
      name: 'agent-host-concrete-adapters-default-deny',
      comment:
        'V2 AgentHost concrete adapters may use Plugin Hooks, the SessionSystem/content-safety public entrypoints, model system, and exact platform libraries; product owners still enter through narrow ports.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/(?:assembly/(?:local-turn-(?:tool|plugin|payload-transform)|messages-file-api-patcher\.ts$)|preparation/|runner/|tools/|native-production-dependencies\.ts$)`,
        pathNot: [
          String.raw`\.test\.ts$`,
          String.raw`(?:^|/)src/service/turn-system/agent-host/runner/ptc/`,
        ],
      },
      to: {
        pathNot: [
          String.raw`(?:^|/)src/service/turn-system/agent-host/`,
          String.raw`(?:^|/)src/service/session-system/index\.ts$`,
          String.raw`(?:^|/)src/service/content-safety/index\.ts$`,
          String.raw`(?:^|/)src/service/model-system/index\.ts$`,
          String.raw`(?:^|/)node_modules/(?:@earendil-works/pi-ai|@mavis/(?:agent-(?:core|runtime|tools)|config|plugin-hooks|protocol|shared|system-reminder)|yaml)(?:/|$)`,
          String.raw`(?:^|/)node_modules/@mavis/conversation-contract/src/index\.ts$`,
          String.raw`^(?:node:)?(?:buffer|crypto|fs/promises|path|url)$`,
        ],
      },
    },
    {
      name: 'agent-host-ptc-worker-adapter-default-deny',
      comment:
        'Only the PTC runner may load QuickJS-WASM and create a Node Worker; its other dependencies stay explicitly bounded.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/agent-host/runner/ptc/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        pathNot: [
          String.raw`(?:^|/)src/service/turn-system/agent-host/`,
          String.raw`(?:^|/)node_modules/@mavis/(?:agent-core|agent-tools)(?:/|$)`,
          String.raw`(?:^|/)node_modules/@sinclair/typebox(?:/|$)`,
          String.raw`(?:^|/)node_modules/@earendil-works/pi-ai(?:/|$)`,
          String.raw`(?:^|/)node_modules/quickjs-emscripten(?:/|$)`,
          String.raw`^(?:node:)?(?:worker_threads|path|url)$`,
        ],
      },
    },
    {
      name: 'context-compaction-default-deny',
      comment:
        'The v2 compaction algorithm depends only on its AgentHost consumer contract and approved neutral algorithm libraries.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/turn-system/compaction/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        pathNot: [
          String.raw`(?:^|/)src/service/turn-system/compaction/`,
          String.raw`(?:^|/)src/service/turn-system/agent-host/contracts\.ts$`,
          String.raw`(?:^|/)node_modules/@earendil-works/pi-(?:agent-core|ai|coding-agent)(?:/|$)`,
          String.raw`(?:^|/)node_modules/@mavis/(?:agent-core|context-manager|goal)(?:/|$)`,
          String.raw`^(?:node:)?(?:buffer|crypto)$`,
        ],
      },
    },
    {
      name: 'event-bus-zero-production-dependencies',
      comment:
        'The generic event bus is mechanical infrastructure and must not know frontend catalogs or business adapters.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/infra/event-bus/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      // This capability is deliberately implemented with the standard language runtime only.
      // Any future import is an architecture decision and must first narrow this rule explicitly.
      to: { path: String.raw`.` },
    },
    {
      name: 'migration-no-current-schema',
      comment: 'Historical migrations must not depend on the mutable current Drizzle schema.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/infra/db/migrations/` },
      to: { path: String.raw`(?:^|/)src/infra/db/schema/` },
    },
    {
      name: 'scheduler-infra-no-v1-runtime',
      comment: 'The v2 Scheduler receives AppDb and must not open the v1 database.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/infra/scheduler/` },
      to: {
        path: v1RuntimeDependencyPaths,
      },
    },
    {
      name: 'runtime-http-via-app-only',
      comment: 'runtime.ts enters the HTTP phase only through http/app.ts.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/runtime\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/http/`,
        pathNot: String.raw`(?:^|/)src/http/app\.ts$`,
      },
    },
    {
      name: 'runtime-local-via-app-only',
      comment: 'runtime.ts enters the process-local delivery phase only through local/app.ts.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/runtime\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/local/`,
        pathNot: [
          String.raw`(?:^|/)src/local/app\.ts$`,
          String.raw`(?:^|/)src/local/host-contract\.ts$`,
        ],
      },
    },
    {
      name: 'runtime-no-concrete-services',
      comment: 'runtime.ts orchestrates the services phase through services.ts.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/runtime\.ts$` },
      to: { path: String.raw`(?:^|/)src/service/` },
    },
    {
      name: 'runtime-no-background-infra',
      comment:
        'runtime.ts may use only the DB client/initializer; every other infrastructure capability is composed behind a narrower root.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/runtime\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/infra/`,
        pathNot: [
          String.raw`(?:^|/)src/infra/db/client\.ts$`,
          String.raw`(?:^|/)src/infra/db/initialize\.ts$`,
        ],
      },
    },
    {
      name: 'background-runtime-infra-only',
      comment:
        'background-runtime.ts owns long-lived infrastructure and must not compose services, compat, HTTP, or local delivery.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/background-runtime\.ts$` },
      to: { path: String.raw`(?:^|/)src/(?:compat/|http/|local/|service/)` },
    },
    {
      name: 'background-runtime-only-runtime',
      comment: 'Only runtime.ts may own the background infrastructure lifecycle.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!runtime\.ts$|background-runtime\.ts$)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/background-runtime\.ts$` },
    },
    {
      name: 'services-only-runtime',
      comment: 'Only runtime.ts may call the business service composition root.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!runtime\.ts$|services\.ts$)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/services\.ts$` },
    },
    {
      name: 'services-no-http',
      comment:
        'services.ts composes business services; HTTP and local delivery adapters consume its ready contracts.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/services\.ts$` },
      to: { path: String.raw`(?:^|/)src/(?:http|local)/` },
    },
    {
      name: 'services-infra-type-only',
      comment:
        'services.ts borrows infrastructure capabilities by type and cannot construct infrastructure values.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/services\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/infra/`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'scheduler-lifecycle-only-background-runtime',
      comment:
        'Only background-runtime.ts may import Scheduler as a value; consumers borrow type-only capabilities.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!background-runtime\.ts$|infra/scheduler/)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/infra/scheduler/`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'compat-only-composition-roots',
      comment:
        'Only runtime.ts, services.ts, and Application may import the temporary compat leaf.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!runtime\.ts$|services\.ts$|application/|compat/)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/compat/` },
    },
    {
      name: 'composition-roots-compat-via-runtime-aggregate',
      comment:
        'Process and service composition roots must use compat/v1/runtime.ts instead of service-specific compat leaves.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/(?:runtime|services)\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/compat/`,
        pathNot: String.raw`(?:^|/)src/compat/v1/runtime\.ts$`,
      },
    },
    {
      name: 'services-compat-type-only',
      comment:
        'services.ts consumes the aggregate compatibility shape; only runtime.ts may create the v1 compatibility value.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/services\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/compat/`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'compat-approved-dependencies-only',
      comment:
        'The compat leaf may only use its exact v1 and v2 service-contract adapter dependencies.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/compat/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        pathNot: [
          String.raw`(?:^|/)src/compat/v1/(?:runtime|agent-host|cron|session|workspace-local-actions)\.ts$`,
          String.raw`(?:^|/)src/service/mcp/index\.ts$`,
          String.raw`(?:^|/)src/service/skill/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/local-runtime-skills\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/local-runtime-safety\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/permission/src/plugin-hook-permission-port\.ts$`,
          String.raw`(?:^|/)src/service/cron/index\.ts$`,
          String.raw`(?:^|/)src/service/agent/index\.ts$`,
          String.raw`(?:^|/)src/service/content-safety/index\.ts$`,
          String.raw`(?:^|/)src/service/session-system/index\.ts$`,
          String.raw`(?:^|/)src/service/turn-system/index\.ts$`,
          String.raw`(?:^|/)src/service/plugin-system/index\.ts$`,
          String.raw`(?:^|/)src/service/workspace/index\.ts$`,
          String.raw`(?:^|/)src/application/session/process-local-application-contract\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/agent-core/src/protocol/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/agent-runtime/src/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/agent-tools/src/desktop/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/local-runtime/dist/index\.d\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/local-runtime/dist/index\.js$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/cron-purpose\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/global-events\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/shared/src/index\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/thrift-gen/src/generated/desktop-service/types\.ts$`,
          String.raw`(?:^|/)node_modules/@mavis/thrift-gen/src/generated/desktop-service/client\.ts$`,
        ],
      },
    },
    {
      name: 'compat-skill-contract-type-only',
      comment: 'Compatibility may bind the v2 Skill capability but cannot construct its owner.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/compat/` },
      to: {
        path: String.raw`(?:^|/)src/service/skill/index\.ts$`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'compat-mcp-contract-type-only',
      comment:
        'Compatibility may bind the v2 MCP capability but must not construct or import its implementation.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/compat/` },
      to: {
        path: String.raw`(?:^|/)src/service/mcp/index\.ts$`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'compat-process-local-contract-type-only',
      comment:
        'The temporary v1 adapter may consume the V2-owned process-local shape only as a compile-time contract.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/compat/v1/runtime\.ts$` },
      to: {
        path: String.raw`(?:^|/)src/application/session/process-local-application-contract\.ts$`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-runtime-imports',
      comment:
        'runtime.ts is the terminal composition root and is exposed only by the package facade.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!runtime\.ts$|index\.ts$)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/runtime\.ts$` },
    },
    {
      name: 'compat-no-runtime-http-or-infra',
      comment:
        'The compat leaf may depend on approved contracts, not runtime, delivery, or infrastructure.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/compat/` },
      to: { path: String.raw`(?:^|/)src/(?:runtime\.ts$|http/|local/|infra/)` },
    },
    {
      name: 'local-delivery-no-http-service-infra-or-compat',
      comment:
        'Process-local delivery composes generated contracts and Applications without bypassing them into HTTP, service, infrastructure, or compatibility implementations.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/local/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/(?:http/|service/|infra/|compat/)` },
    },
    {
      name: 'http-controllers-no-infra',
      comment: 'HTTP controllers depend on services, not infrastructure.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/http/controllers/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/infra/` },
    },
    {
      name: 'no-v1-internal-deep-import',
      comment:
        'v2 may use public v1 package exports, but must not couple to physical src/dist internals or the host API subpath.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/` },
      to: {
        path: [
          String.raw`^@mavis/local-runtime/(?:dist|src|api)(?:/|$)`,
          ...v1RuntimeWorkspaceImplementationPaths,
        ],
      },
    },
    {
      name: 'no-v1-node-modules-relative-deep-import',
      comment:
        'Relative imports must not bypass public package exports through the workspace node_modules link.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/` },
      to: {
        path: String.raw`(?:^|/)node_modules/@mavis/local-runtime/(?:dist|src)(?:/|$)`,
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'plugin-domains-no-v1-or-compat',
      comment:
        'Plugin/App, MCP and Skill own their implementation and contracts; public ports are injected by composition.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/service/(?:plugin-system|mcp|skill|host-connector-system)/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: [...v1RuntimeDependencyPaths, String.raw`(?:^|/)src/compat/`],
      },
    },
    {
      name: 'http-no-v1-runtime-import',
      comment:
        'HTTP modules may reference v1 types, but every v1 runtime dependency belongs in runtime.ts.',
      severity: 'error',
      from: { path: String.raw`(?:^|/)src/http/` },
      to: {
        path: v1RuntimeDependencyPaths,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'v1-runtime-values-only-runtime-or-index',
      comment:
        'Only composition roots and explicit public facades construct or re-export approved v1 values.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/(?!runtime\.ts$|index\.ts$|compat/v1/(?:runtime|session)\.ts$|infra/(?:testing|logging)/index\.ts$)`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: v1RuntimeDependencyPaths,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'http-middleware-no-routing-or-controllers',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/http/middleware/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/http/(?:routing|controllers)/` },
    },
    {
      name: 'http-controllers-no-app-or-middleware',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/http/controllers/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/http/(?:app\.ts$|middleware/)` },
    },
    {
      name: 'http-controllers-no-runtime-routing',
      comment:
        'Controllers may implement generated routing contracts by type, but must not call the routing runtime.',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/http/controllers/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: {
        path: String.raw`(?:^|/)src/http/routing/`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'http-routing-no-app-middleware-or-controllers',
      severity: 'error',
      from: {
        path: String.raw`(?:^|/)src/http/routing/`,
        pathNot: String.raw`\.test\.ts$`,
      },
      to: { path: String.raw`(?:^|/)src/http/(?:app\.ts$|middleware/|controllers/)` },
    },
  ],
  required: [
    {
      name: 'unit-test-imports-source-sibling',
      comment: 'Each colocated unit test must directly import its same-name source module.',
      severity: 'error',
      module: {
        path: String.raw`^(.+)\.test\.ts$`,
        // channel-system unit tests are centralized under its test/ tree
        // (mirroring the source layout), so the colocated-sibling contract
        // does not apply there.
        pathNot: String.raw`(?:^|/)test/unit/|(?:^|/)channel-system/test/`,
      },
      to: { path: String.raw`^$1\.ts$` },
    },
    {
      name: 'agent-unit-test-imports-mirrored-source',
      comment:
        'Package-level Agent unit tests must resolve their mirrored service/agent source module semantically.',
      severity: 'error',
      module: {
        path: String.raw`^((?:.+/)?)test/unit/agent/(.+)\.test\.ts$`,
        pathNot: String.raw`(?:^|/)test/unit/agent/application/agent-application\.test\.ts$`,
      },
      to: { path: String.raw`^$1src/service/agent/$2\.ts$` },
    },
    {
      name: 'agent-application-unit-test-imports-source',
      comment:
        'The package-level Agent application test must resolve its Application source semantically.',
      severity: 'error',
      module: {
        path: String.raw`^((?:.+/)?)test/unit/agent/application/agent-application\.test\.ts$`,
      },
      to: { path: String.raw`^$1src/application/agent/agent-application\.ts$` },
    },
    {
      name: 'compat-unit-test-imports-mirrored-source',
      comment:
        'Package-level compat unit tests must resolve their mirrored src/compat source module semantically.',
      severity: 'error',
      module: {
        path: String.raw`^((?:.+/)?)test/unit/compat/(.+)\.test\.ts$`,
      },
      to: { path: String.raw`^$1src/compat/$2\.ts$` },
    },
    {
      name: 'infra-unit-test-imports-mirrored-source',
      comment:
        'Package-level infra unit tests must resolve their mirrored src/infra source module semantically.',
      severity: 'error',
      module: {
        path: String.raw`^((?:.+/)?)test/unit/infra/(.+)\.test\.ts$`,
      },
      to: { path: String.raw`^$1src/infra/$2\.ts$` },
    },
  ],
  options: {
    doNotFollow: {
      // Keep validating the direct v2 -> v1 edge, but do not apply v2 rules inside the v1 graph.
      path: v1RuntimeResolvedBoundaryPaths,
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'node', 'default'],
    },
    moduleSystems: ['es6', 'cjs'],
    preserveSymlinks: true,
    tsPreCompilationDeps: 'specify',
  },
};
