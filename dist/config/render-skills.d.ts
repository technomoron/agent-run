import type * as nunjucks from 'nunjucks';
import type { NormalizedManifest, RenderContext, RenderedFile, RenderTrace } from '../model';
export declare function buildCanonicalSkills(env: nunjucks.Environment, configRoot: string, manifest: NormalizedManifest, context: RenderContext, trace?: RenderTrace): RenderContext['skills'];
export declare function renderSkillFiles(context: RenderContext, targetDir: string): RenderedFile[];
export declare function validateRenderedSkill(content: string, sourcePath: string): void;
