# Runtime Agents

Mail Magic runs a single Node.js service composed of cooperating agents. Each
agent described below reflects the code that is checked in right now.

- **Bootstrap & Store**
  - Location: `src/index.ts`, `src/store/store.ts`, `src/server.ts`
  - Responsibilities: load configuration, connect infrastructure, and expose
    the API server primitive.
- **Transactional Mail**
  - Location: `src/api/mailer.ts`
  - Responsibilities: persist transactional templates and deliver rendered
    messages.
- **Form Submission**
  - Location: `src/api/forms.ts`
  - Responsibilities: persist form templates and process unauthenticated
    submissions.
- **Config Importer**
  - Location: `src/models/init.ts`
  - Responsibilities: seed the database from `config/` and preprocess
    templates and assets.

## Bootstrap & Store agent

- `createMailMagicServer` and `startMailMagicServer` (`src/index.ts`)
  initialise a `mailStore`, derive API host and port overrides, and register
  API modules before optionally starting the HTTP listener.
- `mailStore` (`src/store/store.ts`) owns runtime state: it loads environment
  variables through `@technomoron/env-loader`, resolves the configured
  `CONFIG_PATH`, creates a Nodemailer transport with TLS and authentication
  options, and connects Sequelize through `connect_api_db`.
- When `DB_AUTO_RELOAD` is true the store watches `init-data.json` for changes
  and re-imports data through `importData`.
- `mailApiServer` (`src/server.ts`) extends `@technomoron/api-server-base` so
  the APIs can authenticate. `getApiKey` looks up an `api_user` by token and
  returns `{ uid: user_id }` to the base server.
- The bootstrap code logs `mail-magic server listening on <host>:<port>` when
  started directly; otherwise it can be imported as a library and the caller
  decides when to start the server.

## Transactional Mail agent

- `MailerAPI` registers two authenticated routes: `POST /v1/tx/template`
  upserts an `api_txmail` record, while `POST /v1/tx/message` renders and sends
  stored templates.
- `assert_domain_and_user` ensures the provided API token belongs to a user and
  that the requested domain exists; both are attached to the request context.
- Email addresses are validated with `email-addresses`. Rendering uses
  Nunjucks (`compile` and `render`), while plain-text parts come from
  `html-to-text`.
- Attachments include assets stored on the template record (`template.files`,
  populated by the Config Importer) plus any files uploaded with the request.
- Template lookup tries the requested locale, then a store-level `deflocale`
  override if one exists, and finally any locale match.
- `buildRequestMeta` enriches each render with client IP details gathered from
  forwarding headers; the metadata appears as `_meta_` inside the template
  context.
- Messages are dispatched through the shared Nodemailer transport created by
  `mailStore`.

## Form Submission agent

- `FormAPI` exposes `POST /v1/form/template` (authenticated) to store form
  templates and `POST /v1/form/message` (unauthenticated) to send a submission
  email.
- Template upserts normalise slugs and filenames with `normalizeSlug`, ensuring
  assets land under `<domain>/form-template[/<locale>]/<form>.njk`.
- Submissions honour optional `secret` values: if a form record stores a secret
  the caller must supply it; only secret-bearing forms allow overrides of the
  recipient address.
- Request bodies and multi-part uploads are passed through to the template as
  `_fields_` and `_files_`, and mirrored in `_attachments_` so templates can
  reference uploaded filenames.
- Rendering uses `nunjucks.renderString`, and the resulting HTML plus
  attachments are sent through the same Nodemailer transport.

## Config Importer agent

- `importData` (`src/models/init.ts`) reads `config/init-data.json`, validates
  the contents with Zod, and upserts users, domains, transactional templates,
  and form templates.
- If a template or form record lacks precompiled HTML, `loadTxTemplate` and
  `loadFormTemplate` flatten the on-disk Nunjucks source with
  `@technomoron/unyuck`, rewrite `asset('file', inline)` calls, and capture
  asset metadata so it can be attached to outgoing messages.
- `extractAndReplaceAssets` enforces asset scoping: it searches the
  domain, type, and locale directories first, falling back to type-level assets
  without leaking files across domains.
- The importer runs on first boot through `connect_api_db` and reruns
  automatically when `DB_AUTO_RELOAD` is enabled and `init-data.json` changes,
  keeping the database aligned with the `config/` tree.
- Sample data lives under `config/ml.yesmedia.no` (domain-scoped assets) and
  `config-example/` (tutorial-friendly scaffold) so the importer can initialise
  a working environment out of the box.
