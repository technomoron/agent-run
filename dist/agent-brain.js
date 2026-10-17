#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compatibility entry for scripts that used the old package-relative path.
const brain_client_1 = require("./brain-client");
if (require.main === module)
    (0, brain_client_1.brainCommand)(process.argv.slice(2));
