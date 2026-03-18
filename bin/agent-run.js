#!/usr/bin/env node

'use strict';

const path = require('path');
const { main } = require('../dist/agent-run');

main(path.basename(process.argv[1]), process.argv.slice(2));
