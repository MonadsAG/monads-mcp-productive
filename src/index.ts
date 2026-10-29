#!/usr/bin/env node
import { createServer } from './server.js';

async function main() {
  // The MCP hub starts the package without arguments; a subcommand runs once and exits. Loaded
  // only here, so a server start does not depend on what the command imports.
  if (process.argv[2] === 'upload-page-images') {
    const { uploadPageImagesCommand } = await import('./upload-page-images.js');
    process.exitCode = await uploadPageImagesCommand(process.argv.slice(3));
    return;
  }

  try {
    await createServer();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
