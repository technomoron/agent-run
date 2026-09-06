#!/usr/bin/env node
import { brainMain, reportBrainError } from './brain/cli';

if (require.main === module) void brainMain(process.argv.slice(2)).catch(reportBrainError);
