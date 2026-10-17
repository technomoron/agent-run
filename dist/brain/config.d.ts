import { z } from 'zod';
export declare function defaultSocketPath(configRoot: string): string;
export declare const brainConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    contextBudget: z.ZodDefault<z.ZodNumber>;
    connectors: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"github">;
        repository: z.ZodString;
        tokenEnv: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"trello">;
        board: z.ZodString;
        keyEnv: z.ZodDefault<z.ZodString>;
        tokenEnv: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>], "type">>>;
}, z.core.$strict>;
export declare function readBrainConfig(root: string): z.infer<typeof brainConfigSchema> | null;
export declare const projectConfigSchema: z.ZodObject<{
    name: z.ZodString;
    display_name: z.ZodOptional<z.ZodString>;
    pool: z.ZodOptional<z.ZodString>;
    roots: z.ZodArray<z.ZodString>;
    description: z.ZodDefault<z.ZodString>;
    repository: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
    }, z.core.$strip>>;
    agent: z.ZodDefault<z.ZodObject<{
        default: z.ZodDefault<z.ZodEnum<{
            codex: "codex";
            claude: "claude";
            gemini: "gemini";
            grok: "grok";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
export type BrainProject = z.infer<typeof projectConfigSchema> & {
    profile: string;
};
export declare function listBrainProjects(configRoot: string): BrainProject[];
export declare function namedBrainProfile(configRoot: string, name: string): string | null;
export declare function registeredBrainProfile(configRoot: string, cwd: string): string | null;
export declare function registeredBrainProject(configRoot: string, cwd: string): {
    profile: string;
    root: string;
    pool?: string;
} | null;
