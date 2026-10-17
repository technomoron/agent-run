import type * as nunjucks from 'nunjucks';
import type { RenderContext, RenderTrace } from '../model';
export declare function renderProfileConfig(env: nunjucks.Environment, configRoot: string, context: RenderContext, overrideFileName: string, globalTemplatePath: string, fallback: () => string, label: string, trace?: RenderTrace): string;
export declare function parseJsonObject(content: string, label: string): Record<string, unknown>;
