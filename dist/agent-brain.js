#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("./brain/cli");
if (require.main === module)
    void (0, cli_1.brainMain)(process.argv.slice(2)).catch(cli_1.reportBrainError);
