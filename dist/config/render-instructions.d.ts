import type * as nunjucks from 'nunjucks';
import type { NormalizedManifest, RenderContext, RenderTrace } from '../model';
export type CanonicalInstructions = {
    sections: string[];
};
export declare function buildCanonicalInstructions(env: nunjucks.Environment, configRoot: string, manifest: NormalizedManifest, context: RenderContext, trace?: RenderTrace): CanonicalInstructions;
export declare function writeAgentsMd(env: nunjucks.Environment, configRoot: string, context: RenderContext, trace?: RenderTrace): string;
export declare function writeClaudeMd(env: nunjucks.Environment, configRoot: string, context: RenderContext, trace?: RenderTrace): string;
