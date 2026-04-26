# agent-run Basic Config

This directory is a small, copyable starter for a repo that wants to keep
agent-run files outside the source tree.

It contains two pieces:

- `project/`: a minimal project with `.agent-run.env` pointing at the bundled
  config root.
- `agent-config/`: a complete config root with global templates, snippets,
  skill templates, a personal memory skill, a profile manifest, profile-local
  instructions, and profile overrides.

Try it from this repository after building:

```sh
pnpm build
node dist/agent-run.js update examples/basic-config/project
node dist/agent-run.js check examples/basic-config/project
```

Generated files are written under `examples/basic-config/agent-config/starter/basic-project/`.
