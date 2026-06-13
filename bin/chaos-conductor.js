#!/usr/bin/env node
// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.
import { buildConductor, runStdioServer } from '../src/server.js';

const cmd = process.argv[2] || 'mcp';

if (cmd === 'mcp') {
  // Default: run the MCP server over stdio (this is what an MCP client launches).
  runStdioServer().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
} else if (cmd === 'status') {
  // Convenience CLI: print the runtime snapshot without an MCP client. Handy for
  // a quick check on the box, or `CONDUCTOR_DRY_RUN=1 ... status` off a droplet.
  const { runtime } = buildConductor();
  const snap = await runtime.statusSnapshot();
  snap.generatedAt = new Date().toISOString();
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.error(`usage: chaos-conductor [mcp|status]\n  mcp     run the MCP server over stdio (default)\n  status  print a one-shot runtime snapshot`);
  process.exit(2);
}
