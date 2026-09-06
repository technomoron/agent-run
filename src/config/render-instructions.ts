import * as fs from 'fs';
import * as path from 'path';
import type * as nunjucks from 'nunjucks';
import { LOCAL_TEMPLATE_FILE_NAME } from '../constants';
import { defaultToolInstructionsTemplate } from '../defaults';
import type { NormalizedManifest, RenderContext, RenderTrace } from '../model';
import {
	assertNoUnexpandedTemplateVars,
	renderTemplateFile,
	resolveConfigPath
} from '../templates';

export type CanonicalInstructions = {
	sections: string[];
};

export function buildCanonicalInstructions(
	env: nunjucks.Environment,
	configRoot: string,
	manifest: NormalizedManifest,
	context: RenderContext,
	trace?: RenderTrace
): CanonicalInstructions {
	const sections = [renderTemplateFile(env, configRoot, manifest.agent.base, context, trace)];
	for (const include of manifest.agent.includes) {
		const includePath = resolveConfigPath(configRoot, include, context as unknown as Record<string, unknown>, env);
		if (!fs.existsSync(includePath)) {
			if (include.includes('AGENTS-MODS.md') || include.includes(LOCAL_TEMPLATE_FILE_NAME)) {
				continue;
			}
			throw new Error(`missing template: ${includePath}`);
		}
		sections.push(renderTemplateFile(env, configRoot, include, context, trace));
	}

	const renderedSections = sections.map((section, index) => {
		const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
		assertNoUnexpandedTemplateVars(label, section);
		return section.trimEnd();
	});
	renderedSections.push(projectMemoryInstructions(context));
	return { sections: renderedSections };
}

export function writeAgentsMd(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	trace?: RenderTrace
): string {
	return renderInstructionFile('AGENTS.md', env, configRoot, context, false, trace);
}

export function writeClaudeMd(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	trace?: RenderTrace
): string {
	return renderInstructionFile('CLAUDE.md', env, configRoot, context, true, trace);
}

function renderInstructionFile(
	templateName: 'AGENTS.md' | 'CLAUDE.md',
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	isClaude: boolean,
	trace?: RenderTrace
): string {
	const templatePath = `global/tool-templates/${templateName}.njk`;
	const content = fs.existsSync(path.join(configRoot, templatePath))
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: env.renderString(defaultToolInstructionsTemplate(isClaude), context);
	assertNoUnexpandedTemplateVars(templateName, content);
	return content.replace(/\n*$/, '\n');
}

function projectMemoryInstructions(context: RenderContext): string {
	return [
		'## Project Memory',
		'',
		`Project memory is stored in ${context.paths.projectMemoryDir}.`,
		'Read README.md there before starting work when prior project context may matter, then read only the linked files relevant to the task.',
		'Do not store secrets, raw chat transcripts, or temporary task state there.',
		'Update project memory only when the user explicitly asks you to remember or update something for this project.'
	].join('\n');
}
