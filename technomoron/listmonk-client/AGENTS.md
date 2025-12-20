# Listmonk Minimcal Client Interface

- You are a client lib, interacting with common functions of Listmonk.
- We are create a npm package that works with both CJS and ESM.
- We are using strict typescript.
- We lint and format using the defaults from
  https://github.com/technomoron/vscode-eslint-defaults, which installs
  in the current dir using (version needs updating as we go)
  curl -L https://github.com/technomoron/vscode-eslint-defaults/releases/download/v1.0.22/installer.tgz | tar -vxz --no-same-owner && node configure-eslint.cjs && rm configure-eslint.cjs
- We always run cleanbuild to test code.
- We always keep changes from last tagged version to next, with
  increments of 0.0.1 unless otherwise specified. Changes are saved
  in CHANGES.
- We never push to git automatically.
- If commiting, just use plain decription, no chore: etc.
- If we have an AGENTS.md file, copy it to ../agents/listmonk-client/
  when you modify it.

## API 

Class methods available:

- `get(path)`, `post(path, body?)`, `put(path, body?)`, `delete(path, body?)`
- `listAllLists(visibility?)`
- `getSubscriber({ id|uuid|email })`
- `setSubscriptions(identifier, listIds, options?)`
- `subscribe(listId, { email, name?, attribs? }, options?)`
- `unsubscribe(identifier, lists?)`
- `addSubscribersToList(listId, entries, options?)`
- `syncUsersToList(listId, users)`
- `updateUser(identifier, updates, options?)`
- `listMembersByStatus(listId, status, pagination?)`
- `blockSubscriber(id)`
- `unblockSubscriber(id)`
- `deleteSubscriber(id)`
- `deleteSubscribers(ids)`
