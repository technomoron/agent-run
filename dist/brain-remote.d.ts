#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { readBrainConfig } from './brain/config';
export type RemoteBrain = NonNullable<NonNullable<ReturnType<typeof readBrainConfig>>['remote']>;
/** OAuth credentials stay in private runtime state, never generated agent configuration. */
export declare class BrainCredentials implements OAuthClientProvider {
    readonly root: string;
    readonly config: RemoteBrain;
    readonly directory: string;
    readonly file: string;
    private verifier;
    authorization?: (url: URL) => void;
    state?: () => string;
    constructor(root: string, config: RemoteBrain);
    get redirectUrl(): string;
    get clientMetadata(): {
        redirect_uris: string[];
        token_endpoint_auth_method: "none";
        grant_types: string[];
        response_types: string[];
        scope: string;
    };
    clientInformation(): {
        client_id: string;
        token_endpoint_auth_method: "none";
    };
    read(): {
        tokens: {
            access_token: string;
            token_type: string;
            id_token?: string | undefined;
            expires_in?: number | undefined;
            scope?: string | undefined;
            refresh_token?: string | undefined;
        };
        expiresAt: number;
    } | undefined;
    tokens(): {
        access_token: string;
        token_type: string;
        id_token?: string | undefined;
        expires_in?: number | undefined;
        scope?: string | undefined;
        refresh_token?: string | undefined;
    } | undefined;
    saveTokens(tokens: OAuthTokens): void;
    invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void;
    redirectToAuthorization(url: URL): void;
    saveCodeVerifier(value: string): void;
    codeVerifier(): string;
    validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL>;
    refresh(rejected?: string): Promise<OAuthTokens>;
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
export declare function connectRemoteBrain(root: string, repository?: string): Promise<Client<{
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    [x: string]: unknown;
    _meta?: {
        [x: string]: unknown;
        progressToken?: string | number | undefined;
        "io.modelcontextprotocol/related-task"?: {
            taskId: string;
        } | undefined;
    } | undefined;
}>>;
export declare function loginRemoteBrain(root: string): Promise<void>;
export declare function proxyRemoteBrain(root: string, repository?: string): Promise<void>;
