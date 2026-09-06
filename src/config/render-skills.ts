import * as fs from 'fs';
import * as path from 'path';
import type * as nunjucks from 'nunjucks';
import type { NormalizedManifest, RenderContext, RenderedFile, RenderTrace } from '../model';
import {
	assertNoUnexpandedTemplateVars,
	createSkillNunjucksEnv,
	resolveConfigPath
} from '../templates';

export function buildCanonicalSkills(
	env: nunjucks.Environment,
	configRoot: string,
	manifest: NormalizedManifest,
	context: RenderContext,
	trace?: RenderTrace
): RenderContext['skills'] {
	const skillEnv = createSkillNunjucksEnv(configRoot, context.profileDir, trace);
	return manifest.skills.install.map((name) => {
		const canonical = `global/skills/${name}/SKILL.md`;
		const sourceTemplate = manifest.skills.overrides[name] ?? (fs.existsSync(path.join(configRoot, canonical)) ? canonical : `${canonical}.njk`);
		const sourcePath = resolveConfigPath(configRoot, sourceTemplate, context as unknown as Record<string, unknown>, env);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(`missing skill template for ${name}: ${sourcePath}`);
		}
		const renderedContent = skillEnv.render(path.relative(configRoot, sourcePath), context);
		assertNoUnexpandedTemplateVars(`skill ${name}`, renderedContent);
		validateRenderedSkill(renderedContent, sourcePath);
		return { name, sourcePath, renderedContent, description: extractSkillDescription(renderedContent) };
	});
}

export function renderSkillFiles(context: RenderContext, targetDir: string): RenderedFile[] {
	return context.skills.map((skill) => ({
		path: path.join(targetDir, skill.name, 'SKILL.md'),
		content: skill.renderedContent
	}));
}

export function validateRenderedSkill(content: string, sourcePath: string): void {
	const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(content.replace(/\r\n/g, '\n'));
	if (frontMatter === null) {
		throw new Error(`generated skill missing YAML front matter: ${sourcePath}`);
	}
	const yaml = frontMatter[1] ?? '';
	if (!/^name:\s*\S+/m.test(yaml)) {
		throw new Error(`generated skill missing name: ${sourcePath}`);
	}
	if (!/^description:\s*(?:\S|>\s*$)/m.test(yaml)) {
		throw new Error(`generated skill missing description: ${sourcePath}`);
	}
}

function extractSkillDescription(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const simple = /^description:\s*['"]?(.+?)['"]?\s*$/m.exec(normalized);
	if (simple?.[1]) {
		return simple[1].trim();
	}
	const folded = /^description:\s*>\s*\n((?:[ \t]+.+\n?)+)/m.exec(normalized);
	return folded?.[1]
		? folded[1].split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
		: '';
}
