import { config } from 'dotenv';
import path from 'node:path';

// Load local .dev.vars (dotenv format) so integration tests can pick up real
// credentials for a test Productive.io organization. This file is gitignored
// and never printed/logged — see CLAUDE.md's BYOT section for why secrets
// must never surface in tool output or logs; the same rule applies to tests.
//
// Silence dotenv's own stdout output while loading, mirroring the pattern in
// src/config/index.ts (this project's convention: stdout must stay clean).
const originalWrite = process.stdout.write;
process.stdout.write = () => true;

config({ path: path.resolve(process.cwd(), '.dev.vars') });

process.stdout.write = originalWrite;
