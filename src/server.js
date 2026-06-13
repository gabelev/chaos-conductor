// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from './config.js';
import { makeRunner } from './exec.js';
import { makeRuntime } from './runtime.js';
import { buildTools } from './tools.js';

export const SERVER_INFO = { name: 'chaos-conductor', version: '0.1.0' };

// Wire config -> runner -> runtime -> tools. `log` goes to stderr so it never
// corrupts the stdio JSON-RPC stream on stdout.
export function buildConductor(env = process.env) {
  const config = getConfig(env);
  const run = makeRunner({ dryRun: config.dryRun, timeoutMs: config.execTimeoutMs, log: (m) => console.error(m) });
  const runtime = makeRuntime({ run, config });
  const tools = buildTools(runtime);
  return { config, runtime, tools };
}

export function buildServer(env = process.env) {
  const { tools } = buildConductor(env);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName[request.params.name];
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }] };
    }
    try {
      const result = await tool.handler(request.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `error: ${err?.message ?? String(err)}` }] };
    }
  });

  return server;
}

export async function runStdioServer(env = process.env) {
  const server = buildServer(env);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('chaos-conductor MCP server ready (stdio)');
}
