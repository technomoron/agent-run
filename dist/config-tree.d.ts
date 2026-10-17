type PlannedMove = {
    source: string;
    target: string;
};
export type ProfileLayoutMigrationResult = {
    gitMoves: number;
    projectMemoryMoves: number;
    runtimeMoves: number;
};
export type GitMoveConfirmation = {
    gitRoot: string;
    moves: PlannedMove[];
};
export declare function ensureConfigRootLayout(configRoot: string): void;
export declare function ensureConfigRootGitignore(configRoot: string): void;
export declare function ensureDefaultGlobalTemplates(configRoot: string): void;
export declare function migrateOldTemplates(configRoot: string): void;
export declare function findLegacyProfileDirs(configRoot: string): string[];
export declare function findProfileDirs(configRoot: string): string[];
export declare function convertLegacyTemplateVars(content: string): string;
export declare function migrateCodexRuntimeFiles(agentDir: string): number;
export declare function migrateLooseFiles(agentDir: string, pattern: RegExp, targetDirName: string): number;
export declare function describeLegacyProfileLayout(profileDir: string, configRoot?: string): string[];
export declare function migrateProfileLayout(configRoot: string, profileDir: string, confirmGitMoves: (confirmation: GitMoveConfirmation) => boolean): ProfileLayoutMigrationResult;
export declare function starterConfigRootPath(): string;
export declare function copySkeletonTree(sourceDir: string, targetDir: string, excludedNames?: ReadonlySet<string>): void;
export {};
