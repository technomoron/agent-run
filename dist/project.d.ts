import { ToolName } from './model';
export declare function resolveAgentDir(projectRoot: string): string;
export declare function findLocalAiFiles(projectRoot: string, excludedDir?: string | null): string[];
export declare function findSourceRepos(rootPath: string): string[];
export declare function hasProjectFileScope(projectRoot: string, profile: string): boolean;
export declare function isIgnoredDir(dir: string): boolean;
export declare function warnForLocalAiFiles(tool: ToolName | null, projectRoot: string, localAiFiles: string[]): void;
export declare function failForLocalAiFiles(tool: ToolName, projectRoot: string, localAiFiles: string[]): never;
export declare function findProjectRoot(cwd: string): string;
export declare function resolveProfile(projectRoot: string): string;
export declare function resolveProfileResult(projectRoot: string, configRoot?: string, useDefault?: boolean): {
    profile: string | null;
    reason: string;
};
export declare function resolveGitHubProfile(projectRoot: string): string | null;
export declare function parseProfile(profile: string, source: string): {
    profile: string | null;
    reason: string;
};
export declare function projectRootForProfile(profile: string, configRoot?: string): string;
export declare function parseEnvFile(content: string): Record<string, string>;
export declare function defaultConfigRoot(projectRoot?: string): string;
