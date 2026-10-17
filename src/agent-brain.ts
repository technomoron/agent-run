#!/usr/bin/env node
// Compatibility entry for scripts that used the old package-relative path.
import { brainCommand } from './brain-client';
if (require.main === module) brainCommand(process.argv.slice(2));
