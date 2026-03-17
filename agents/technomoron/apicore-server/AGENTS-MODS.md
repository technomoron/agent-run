@../../../templates/AGENTS-CODE.md

#agent api-server-base

## Project Snapshot
- TypeScript library that wraps Express to provide a reusable API server skeleton.
- Distributed as both CommonJS (`dist/cjs`) and ES modules (`dist/esm`); `package.json` points to both builds and exports shared type definitions.
- JWT and cookie based authentication baked in; API keys supported through `getApiKey` extension hook.
- Minimal dependencies at runtime (Express ecosystem only); repository ships TypeScript types as peerDeps so consumers keep ownership of their versions.

## Source Layout
- `src/api-server-base.ts` holds all core classes, types, and helpers.
- `src/index.ts` is the single re-export surface to keep bundlers happy.
- `tsconfig/` contains three configs: a base config (`tsconfig.json`) plus CJS and ESM variants that override `module` and `outDir`.
- `dist/` is generated; do not edit it manually.
- Tests live under `tests/`: fast, deterministic checks sit in `tests/unit/`, while integration/DB/web flows live in `tests/functional/` (treat these as backwards-compat coverage and avoid changing expectations unless the public contract intentionally shifts).

## Key Abstractions
- `ApiServer`
  - Constructs the Express app, sets JSON + cookie parsing, and wires configurable CORS.
  - Owns the runtime configuration object (`ApiServerConf`); `fillConfig` merges user overrides with defaults.
  - Provides JWT helpers (`jwtSign`, `jwtVerify`, `jwtDecode`) and auth orchestration (`authenticate`, `verifyJWT`).
  - Wraps all route handlers to standardize request/response flow and error handling.
  - Exposes extension hooks (`getApiKey`, `getUser`, `authorize`, etc.) that must be implemented downstream.
- `ApiModule<T extends ApiServer>`
  - Lightweight base class for feature modules; override `defineRoutes()` to return an array of `ApiRoute` definitions.
  - Each module is mounted under `${config.apiBasePath}${module.namespace}`. Override `namespace` in the constructor or via the static `defaultNamespace`.
  - `checkConfig()` lets modules validate the server configuration prior to mounting.
- `ApiRoute`
  - Describes one Express route: HTTP `method`, relative `path`, `handler`, and `auth` requirements.
  - `handler` receives an `ApiRequest` wrapper (`server`, `req`, `res`, optional `tokenData`, plus current JWT).
- `ApiError`
  - Custom error that carries HTTP `code`, optional payload `data`, and validation `errors`.
  - Use it for known failures so the client receives structured error JSON.

## Request Lifecycle
1. Express middleware stack runs (`express.json`, `cookie-parser`, CORS).
2. `ApiServer.handle_request` captures `req`/`res` into an `ApiRequest`; when `config.debug` is true it logs inbound metadata via `dumpRequest`.
3. `authenticate` resolves `auth.type`:
   - `none`: skips auth entirely.
   - `maybe`: attempts JWT/API-key auth but allows anonymous access.
   - `yes`: enforces JWT or API key; looks at `Authorization: Bearer` header, falls back to the `dat` cookie (access token).
4. When a JWT is present, `verifyJWT` validates the signature and payload using `config.accessSecret`; rejected tokens produce an `ApiError`.
5. With a token identified, `authorize` is invoked (empty in base class; override to enforce `ApiAuthClass` such as `'admin'`).
6. The route handler executes and returns `[status, data?, message?]`; the wrapper converts that tuple into a JSON response.
7. Errors propagate to the wrapper: `ApiError` instances map directly to JSON; unknown errors fall back to a 500 with a best-effort message from `guessExceptionText`.

## Configuration Defaults (`ApiServerConf`)
- Sensible fallbacks exist for all fields; override by passing a partial config to the constructor.
- Important keys: `apiPort`, `apiHost`, `apiBasePath`, `origins` (CORS allowlist), `uploadPath` (enables Multer), `accessSecret`/`refreshSecret`, cookie names (`accessCookie`, `refreshCookie`), and token expiries.
- Upload handling is opt-in. Provide `uploadPath` to mount a global `multer.any()` middleware.
- `authApi` and `devMode` flags are available for custom behavior in subclasses.

## Coding Style & Conventions
- Git commit style is Conventional Commits - https://www.conventionalcommits.org/en/v1.0.0/
- Tabs for indentation; keep files ASCII; ESLint disables the default `no-tabs` rule.
- Semicolons required (`semi: 'always'`); trailing commas discouraged (`comma-dangle: never`).
- Always run 'cleanbuild' target to check for errors and format source.
- Imports must be ordered and grouped (`import/order` rule); place third-party packages before relative paths, leave a blank line between groups.
- Prefer `async/await` and return Promises explicitly; handlers must resolve to tuple responses.
- Keep types explicit when exposing surfaces (interfaces, `export type`) but internal implementations may use `any` sparingly (rule relaxed).
- Use the provided error/types utilities rather than ad-hoc shapes so the public API stays stable.

## Extending the Server
- Derive a concrete server class from `ApiServer` to implement persistence and auth hooks (`getUser`, `storeToken`, `verifyPassword`, etc.).
- Build feature modules by subclassing `ApiModule`:

```ts
import { ApiModule, ApiServer, ApiError } from '@technomoron/api-server-base';

class UserModule extends ApiModule<ApiServer> {
	constructor() {
		super({ namespace: '/users' });
	}

	defineRoutes() {
		return [
			{
				method: 'get',
				path: '/',
				auth: { type: 'yes', req: 'any' },
				handler: async ({ server, tokenData }) => {
					const storage = server.getAuthStorage();
					const user = tokenData ? await storage.getUser(tokenData.uid) : null;
					if (!user) {
						throw new ApiError({ code: 404, message: 'User not found' });
					}
					return [200, storage.filterUser(user)];
				},
			},
		];
	}
}
```

- Mount modules by calling `server.api(new UserModule())` before `start()`.
- Override `authorize` or individual route handlers to enforce `ApiAuthClass` levels beyond the default `'any'`.

## Tooling & Scripts
- `npm run build` compiles both module formats; `prepublishOnly` ensures builds ship before publishing.
- `npm run lint` / `npm run lintfix` run ESLint with the flat config (`eslint.config.mjs`).
- `npm run pretty` invokes Prettier across common file types; `npm run format` chains `lintfix` and Prettier.
- `npm run cleanbuild` wipes `dist/`, formats, lints, and rebuilds.
- Tests: `npm test` runs everything, `npm run test:unit` for the fast unit set, `npm run test:functional` for integration/DB flows. Keep unit tests stable for backwards compatibility; only relax expectations intentionally.

## Practical Tips
- Keep new exports funneled through `src/index.ts` to preserve the public surface.
- When adding fields to `ApiServerConf`, update `fillConfig` to maintain default coverage.
- Enable `config.debug` during development to get verbose request dumps; disable in production to avoid logging sensitive data.
- Prefer throwing `ApiError` for expected failures so consumers always get consistent response envelopes.
