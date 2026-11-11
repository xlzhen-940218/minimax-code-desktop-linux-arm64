#!/usr/bin/env node
// Manual-test demo MCP server (stdio). Exposes ~8 trivial tools — including a
// Chinese-described `weather_today` — so the MCP tool-search disclosure feature
// has enough tools to exceed a low threshold and defer the `configured` MCP
// tools behind `tool_search` + `mcp_invoke`.
//
// Wire into {dataDir}/mcp.json:
//   {
//     "mcpServers": {
//       "demo": {
//         "type": "stdio",
//         "command": "node",
//         "args": ["<abs path>/packages/local-runtime-v2/scripts/migrated/demo-mcp-server.mjs"],
//         "enabled": true
//       }
//     }
//   }
//
// Then start the app with the feature enabled, e.g.:
//   MAVIS_MCP_TOOL_SEARCH_WHITELIST='*' \
//   MAVIS_MCP_TOOL_SEARCH_THRESHOLD_PCT='0.01' \
//   MAVIS_LOCAL_RUNTIME_PORT=0 pnpm dev
//
// Quick smoke check (no app needed) — pipe an initialize + tools/list in:
//   printf '%s\n%s\n' \
//     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
//     '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
//     | node packages/local-runtime-v2/scripts/migrated/demo-mcp-server.mjs
// You should see a tools list that includes `weather_today`.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Tool registry: name → { description, inputSchema, run(args) → string }.
 * Kept intentionally tiny; every tool returns a single text block.
 */
const TOOLS = {
  weather_today: {
    description: '查询指定城市今天的实时天气',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: '城市名称，例如 北京' } },
      required: ['city'],
      additionalProperties: false,
    },
    run: (args) => `天气晴朗，26°C：${String(args?.city ?? '')}`,
  },
  echo: {
    description: 'Echo back the provided text unchanged.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: (args) => String(args?.text ?? ''),
  },
  add: {
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    run: (args) => String(Number(args?.a ?? 0) + Number(args?.b ?? 0)),
  },
  reverse_text: {
    description: 'Reverse the characters in a string.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: (args) => [...String(args?.text ?? '')].reverse().join(''),
  },
  uuid: {
    description: 'Generate a random RFC-4122 v4 UUID.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => globalThis.crypto.randomUUID(),
  },
  now: {
    description: 'Return the current time as a Unix epoch in milliseconds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => String(Date.now()),
  },
  slugify: {
    description: 'Convert text to a lowercase hyphen-separated slug.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: (args) =>
      String(args?.text ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
  },
  word_count: {
    description: 'Count the whitespace-separated words in a string.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: (args) => {
      const trimmed = String(args?.text ?? '').trim();
      return String(trimmed === '' ? 0 : trimmed.split(/\s+/).length);
    },
  },
};

const server = new Server(
  { name: 'demo-mcp-server', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS[name];
  if (!tool) {
    // MCP error result (isError true) rather than a protocol error, so the
    // model sees an actionable message and can retry with a known tool name.
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  const text = tool.run(args ?? {});
  return { content: [{ type: 'text', text }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The stdio transport keeps the process alive while stdin is open and closes
  // it when stdin ends, so there is nothing else to do here.
}

main().catch((err) => {
  process.stderr.write(`demo-mcp-server fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
