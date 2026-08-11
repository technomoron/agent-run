"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInvocation = parseInvocation;
const fs = require("fs");
const path = require("path");
const constants_1 = require("./constants");
const project_1 = require("./project");
const utils_1 = require("./utils");
function parseInvocation(invokedTool, argv) {
    let command = normalizeCommandName(invokedTool);
    const options = extractGlobalOptions(argv);
    applyGlobalOptions(options);
    if (command === null) {
        command = extractCommand(options.args);
    }
    return parseCommand(command, options.args);
}
function applyGlobalOptions(options) {
    if (options.verbose) {
        process.env[constants_1.VERBOSE_ENV] = '1';
    }
    if (options.configRootOverride !== null) {
        process.env[constants_1.CONFIG_ROOT_OVERRIDE_ENV] = options.configRootOverride;
    }
}
function extractCommand(args) {
    if (args.length === 0) {
        (0, utils_1.fail)('usage: agent-run <codex|claude|check|init|edit|update> [options] (run with --help for details)');
    }
    if (isHelpFlag(args[0])) {
        printHelp('general');
    }
    if (isVersionFlag(args[0])) {
        printVersion();
    }
    const commandIndex = args.findIndex((arg) => arg !== '--' && normalizeCommandName(arg) !== null);
    if (commandIndex === -1 || args.slice(0, commandIndex).includes('--')) {
        (0, utils_1.fail)(`unknown command: ${args[0] ?? ''} (run with --help for usage)`);
    }
    const command = normalizeCommandName(args[commandIndex] ?? '');
    if (command === null) {
        (0, utils_1.fail)(`unknown command: ${args[0] ?? ''} (run with --help for usage)`);
    }
    args.splice(commandIndex, 1);
    return command;
}
function parseCommand(command, args) {
    switch (command) {
        case 'check':
            return parseCheckCommand(args);
        case 'init':
            return parseInitCommand(args);
        case 'setup':
            return parseSetupCommand(args);
        case 'edit':
            return parseEditCommand(args);
        case 'update':
            return parseUpdateCommand(args);
        case 'migrate-config':
            return parseMigrateConfigCommand(args);
        default:
            return parseRunCommand(command, args);
    }
}
function extractGlobalOptions(argv) {
    const options = {
        args: [],
        configRootOverride: null,
        verbose: false
    };
    let passthrough = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === undefined) {
            continue;
        }
        if (passthrough) {
            options.args.push(arg);
            continue;
        }
        if (arg === '--') {
            passthrough = true;
            options.args.push(arg);
        }
        else if (arg === '-v' || arg === '--verbose') {
            options.verbose = true;
        }
        else if (arg === '--config-root') {
            const nextArg = argv[index + 1];
            if (nextArg === undefined) {
                (0, utils_1.fail)('missing value for --config-root');
            }
            options.configRootOverride = path.resolve(nextArg);
            index += 1;
        }
        else if (arg.startsWith('--config-root=')) {
            const rootValue = arg.slice('--config-root='.length);
            if (!rootValue) {
                (0, utils_1.fail)('missing value for --config-root');
            }
            options.configRootOverride = path.resolve(rootValue);
        }
        else {
            options.args.push(arg);
        }
    }
    return options;
}
function parseRunCommand(command, inputArgs) {
    const wrapperArgs = {
        none: false,
        create: false,
        local: false,
        show: false,
        generate: false,
        sandboxMode: null,
        codexNetwork: false
    };
    const args = [];
    let passthrough = false;
    for (const arg of inputArgs) {
        if (passthrough) {
            args.push(arg);
            continue;
        }
        if (arg === '--') {
            passthrough = true;
            args.push(arg);
            continue;
        }
        if (applyCommonRunOption(arg, wrapperArgs)) {
            continue;
        }
        if (applySandboxRunOption(command, arg, wrapperArgs)) {
            continue;
        }
        args.push(arg);
    }
    if (wrapperArgs.codexNetwork && wrapperArgs.sandboxMode === 'danger') {
        (0, utils_1.fail)('--network cannot be combined with agent-run codex --yolo');
    }
    return { args, command, wrapperArgs };
}
function applyCommonRunOption(arg, options) {
    const fields = {
        '--none': 'none',
        '--create': 'create',
        '--local': 'local',
        '--show': 'show',
        '--generate': 'generate'
    };
    const field = fields[arg];
    if (field === undefined) {
        return false;
    }
    options[field] = true;
    return true;
}
function applySandboxRunOption(command, arg, options) {
    if (!['--yolo', '--sandboxed', '--network'].includes(arg)) {
        return false;
    }
    if (arg !== '--yolo' && command !== 'codex') {
        (0, utils_1.fail)(`${arg} is only supported for agent-run codex`);
    }
    if (arg === '--network') {
        options.codexNetwork = true;
        return true;
    }
    const mode = arg === '--yolo' ? 'danger' : 'sandboxed';
    if (options.sandboxMode !== null && options.sandboxMode !== mode) {
        (0, utils_1.fail)('cannot combine --yolo and --sandboxed');
    }
    options.sandboxMode = mode;
    return true;
}
function parseCheckCommand(inputArgs) {
    let all = false;
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('check');
        }
        if (arg === '--all') {
            all = true;
        }
        else if (arg.startsWith('--')) {
            (0, utils_1.fail)(`unknown check option: ${arg}`);
        }
        else {
            targetPath = arg;
        }
    }
    return { all, command: 'check', targetPath: path.resolve(targetPath) };
}
function parseInitCommand(inputArgs) {
    return { command: 'init', targetPath: parseSinglePath(inputArgs, 'init') };
}
function parseSetupCommand(inputArgs) {
    return { command: 'setup', targetPath: parseSinglePath(inputArgs, 'setup', (0, project_1.defaultConfigRoot)()) };
}
function parseEditCommand(inputArgs) {
    return { command: 'edit', targetPath: parseSinglePath(inputArgs, 'edit') };
}
function parseSinglePath(inputArgs, command, defaultPath = process.cwd()) {
    let targetPath = defaultPath;
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp(command);
        }
        if (arg.startsWith('--')) {
            (0, utils_1.fail)(`unknown ${command} option: ${arg}`);
        }
        targetPath = arg;
    }
    return path.resolve(targetPath);
}
function parseUpdateCommand(inputArgs) {
    let all = false;
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('update');
        }
        if (arg === '--all') {
            all = true;
        }
        else if (arg.startsWith('--')) {
            (0, utils_1.fail)(`unknown update option: ${arg}`);
        }
        else {
            targetPath = arg;
        }
    }
    return { all, command: 'update', targetPath: path.resolve(targetPath) };
}
function parseMigrateConfigCommand(inputArgs) {
    let configRoot = (0, project_1.defaultConfigRoot)();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('migrate-config');
        }
        if (arg.startsWith('--')) {
            (0, utils_1.fail)(`unknown migrate-config option: ${arg}`);
        }
        configRoot = arg;
    }
    return { command: 'migrate-config', configRoot: path.resolve(configRoot) };
}
function isHelpFlag(value) {
    return value === '-h' || value === '--help';
}
function isVersionFlag(value) {
    return value === '-V' || value === '--version';
}
function printVersion() {
    process.stdout.write(`agent-run ${agentRunVersion()}\n`);
    process.exit(0);
}
function printHelp(topic) {
    process.stdout.write(renderHelp(topic));
    process.exit(0);
}
function renderHelp(topic) {
    const help = {
        check: [
            'Usage:',
            '  agent-run check [--all] [path]',
            '',
            'Check generated profile files, native skills, guard shims, and local AI-file leaks.',
            '',
            'Options:',
            '  -h, --help  Show this help text',
            '  --all       Check every repo under path',
            ''
        ],
        init: ['Usage:', '  agent-run init [path]', '', 'Create a minimal mapped profile marker and render generated files.', ''],
        setup: ['Usage:', '  agent-run setup [config-root]', '', 'Create starter agent configuration files in the config root.', ''],
        edit: ['Usage:', '  agent-run edit [path]', '', 'Create or open the editable local profile template.', ''],
        update: [
            'Usage:',
            '  agent-run update [--all] [path]',
            '',
            'Render generated files, native skills, config, and guard shims for an existing profile.',
            'With --all, render every profile found under the config root without requiring code checkouts.',
            ''
        ],
        'migrate-config': [
            'Usage:',
            '  agent-run migrate-config [config-root]',
            '',
            'Convert an existing agent config tree to the current manifest and global-template layout.',
            ''
        ]
    };
    if (topic !== 'general') {
        return help[topic].join('\n');
    }
    return [
        `agent-run ${agentRunVersion()}`,
        '',
        'Usage:',
        '  agent-run <codex|claude|check|setup|init|edit|update> [options]',
        '',
        'Commands:',
        '  codex [--none] [--create] [--local] [--show] [--generate] [--yolo|--sandboxed] [--network] [args...]',
        '                                           Run codex with generated private config',
        '  claude [--none] [--create] [--local] [--show] [--generate] [--yolo] [args...]',
        '                                           Run claude with generated private config',
        '  setup [config-root]                    Create starter files in the agent-config root',
        '  check [--all] [path]                  Validate generated profile output',
        '  init [path]                           Create a sparse profile marker and render output',
        '  edit [path]                           Create or open local.md.njk',
        '  update [--all] [path]                 Regenerate existing profile output',
        '  migrate-config [config-root]           Convert existing config tree layout',
        '',
        'Global options:',
        '  -h, --help         Show this help text',
        '  -V, --version      Show the agent-run version',
        '  -v, --verbose      Print path resolution and wrapper actions',
        '  --config-root DIR  Override the agent-config root',
        '',
        'Run wrapper options:',
        '  --local            Warn about local AI files instead of failing',
        '  --show             Show read/include and generated files without running the tool',
        '  --generate         Generate files without running the tool',
        '  --yolo             Run unattended without approval prompts:',
        '                     Codex with -a never -s danger-full-access,',
        '                     Claude with --dangerously-skip-permissions',
        '',
        'Codex wrapper options:',
        '  --sandboxed        Run Codex with workspace-write sandbox (default)',
        '  --network          Enable network for the workspace-write sandbox',
        ''
    ].join('\n');
}
function agentRunVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' && pkg.version ? pkg.version : constants_1.PACKAGE_VERSION;
    }
    catch {
        return constants_1.PACKAGE_VERSION;
    }
}
function normalizeCommandName(value) {
    if (!value) {
        return null;
    }
    const base = path.basename(value).toLowerCase().replace(/\.(?:js|cmd|exe|bat)$/, '');
    if (base === 'agent-run') {
        return null;
    }
    return ['codex', 'claude', 'check', 'setup', 'init', 'edit', 'update', 'migrate-config'].includes(base)
        ? base
        : null;
}
