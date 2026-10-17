import * as nunjucks from 'nunjucks';
import { NormalizedManifest, RenderContext, RenderTrace } from './model';
export declare function createNunjucksEnv(configRoot: string): nunjucks.Environment;
export declare function createSkillNunjucksEnv(configRoot: string, profileDir: string, trace?: RenderTrace, pool?: string): nunjucks.Environment;
export declare function buildRenderContext(projectRoot: string, profileDir: string, configRoot: string, manifest: NormalizedManifest, env: nunjucks.Environment): RenderContext;
export declare function resolveConfigPath(configRoot: string, relativePath: string, context: Record<string, unknown>, env: nunjucks.Environment): string;
export declare function renderTemplateFile(env: nunjucks.Environment, configRoot: string, templatePath: string, context: object, trace?: RenderTrace): string;
export declare function assertNoUnexpandedTemplateVars(label: string, content: string): void;
