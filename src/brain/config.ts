import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { isSamePathOrDescendant } from '../utils';

export function defaultSocketPath(configRoot: string): string {
	return path.join(configRoot, 'runtime', 'agent-brain.sock');
}

export const brainConfigSchema = z.object({
	enabled: z.boolean().default(true),
	contextBudget: z.number().int().min(1000).max(100000).default(16000),
	connectors: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.discriminatedUnion('type', [
		z.object({ type: z.literal('github'), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/), tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('GITHUB_TOKEN') }).strict(),
		z.object({ type: z.literal('trello'), board: z.string().regex(/^[a-zA-Z0-9]+$/), keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('TRELLO_API_KEY'), tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('TRELLO_TOKEN') }).strict()
	])).default({})
}).strict();

export function readBrainConfig(root: string): z.infer<typeof brainConfigSchema> | null {
	const file = path.join(root, 'brain.jsonc');
	if (!fs.existsSync(file)) return null;
	const errors: ParseError[] = [];
	const value: unknown = parseJsonc(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
	if (errors.length) throw new Error(`Invalid JSONC in ${file}`);
	return brainConfigSchema.parse(value);
}

export const projectConfigSchema = z.object({
	name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/),
	display_name: z.string().optional(),
	roots: z.array(z.string().refine(path.isAbsolute, 'Source roots must be absolute paths')).min(1),
	description: z.string().default(''),
	repository: z.object({ url: z.string() }).optional(),
	agent: z.object({ default: z.enum(['codex', 'claude', 'gemini', 'grok']).default('codex') }).default({ default: 'codex' })
}).strict();

export type BrainProject = z.infer<typeof projectConfigSchema> & { profile: string };

export function listBrainProjects(configRoot: string): BrainProject[] {
	const directory = path.join(configRoot, 'projects');
	if (!fs.existsSync(directory)) return [];
	function scan(parent: string): BrainProject[] {
		return fs.readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
		const child = path.join(parent, entry.name);
		const file = path.join(child, 'config.yaml');
		if (!fs.existsSync(file)) return scan(child);
		if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Project configuration must not be a symlink: ${file}`);
		const config = projectConfigSchema.parse(parseYaml(fs.readFileSync(file, 'utf8')));
		if (config.name !== path.relative(directory, child).split(path.sep).join('/')) throw new Error(`Project name must match directory: ${file}`);
		return [{ ...config, profile: `projects/${config.name}` }];
		});
	}
	return scan(directory);
}

export function namedBrainProfile(configRoot: string, name: string): string | null {
	return listBrainProjects(configRoot).find((project) => project.name === name || project.profile === name)?.profile ?? null;
}

export function registeredBrainProfile(configRoot: string, cwd: string): string | null {
	return registeredBrainProject(configRoot, cwd)?.profile ?? null;
}

export function registeredBrainProject(configRoot: string, cwd: string): { profile: string; root: string } | null {
	const matches = listBrainProjects(configRoot).flatMap((project) => project.roots
		.filter((root) => isSamePathOrDescendant(path.resolve(cwd), path.resolve(root)))
		.map((root) => ({ profile: project.profile, root: path.resolve(root), length: path.resolve(root).length }))
	).sort((a, b) => b.length - a.length);
	if (matches[0] && matches[1] && matches[0].length === matches[1].length && matches[0].profile !== matches[1].profile) {
		throw new Error(`More than one project is configured for ${cwd}`);
	}
	return matches[0] ?? null;
}
