import * as fs from 'fs';
import * as path from 'path';
import type * as nunjucks from 'nunjucks';
import type { RenderContext, RenderTrace } from '../model';
import { assertNoUnexpandedTemplateVars, renderTemplateFile } from '../templates';
import { formatError } from '../utils';

export function renderProfileConfig(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	overrideFileName: string,
	globalTemplatePath: string,
	fallback: () => string,
	label: string,
	trace?: RenderTrace
): string {
	const templatePath = resolveProfileOverrideTemplate(configRoot, context, overrideFileName, globalTemplatePath);
	const content = templatePath
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: fallback();
	assertNoUnexpandedTemplateVars(label, content);
	return content.replace(/\n*$/, '\n');
}

export function parseJsonObject(content: string, label: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(content);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('top-level value must be an object');
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(`invalid generated ${label} JSON: ${formatError(error)}`);
	}
}

function resolveProfileOverrideTemplate(
	configRoot: string,
	context: RenderContext,
	overrideFileName: string,
	globalTemplatePath: string
): string | null {
	const overridePath = `${context.profile}/overrides/${overrideFileName}`;
	if (fs.existsSync(path.join(configRoot, overridePath))) {
		return overridePath;
	}
	return fs.existsSync(path.join(configRoot, globalTemplatePath)) ? globalTemplatePath : null;
}
