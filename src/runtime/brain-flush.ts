import type { RenderContext } from '../model';
import { readBrainConfig } from '../brain/config';
import { connectRemoteBrain } from '../brain-remote';

/** Exit synchronization never hides an unsynced result or changes the agent's exit code. */
export async function flushBrainOnExit(context: RenderContext): Promise<void> {
 const config = readBrainConfig(context.configRoot);
 const server = context.mcpServers['agent-brain'];
 if (!config?.enabled || !config.remote || !server?.enabled) return;
 const position = server.args.indexOf('--repository');
 if (position < 0) return; // Discovery sessions have no writable project scope.
 let client: Awaited<ReturnType<typeof connectRemoteBrain>> | undefined;
 try {
  process.stderr.write('agent-run: syncing Brain changes to GitHub…\n');
  client = await connectRemoteBrain(context.configRoot, server.args[position + 1]);
  const result = await client.callTool({ name: 'brain_flush', arguments: {} }, undefined, { timeout: 200000 });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  const content = result.content;
  const text = Array.isArray(content) ? content.find(item => item.type === 'text') : undefined;
  const status = text && text.type === 'text' ? JSON.parse(text.text) : undefined;
  if (status?.state !== 'synced') throw new Error('Brain did not confirm a successful sync.');
  process.stderr.write(`agent-run: ${status.files ? `Brain changes pushed (${status.files} files).` : 'Brain is up to date.'}\n`);
 } catch (error) {
  process.stderr.write(`agent-run: WARNING: Brain sync failed; changes remain on the server. Retry "brain sync" or "brain flush" in chat. ${error instanceof Error ? error.message : String(error)}\n`);
 } finally { try { await client?.close(); } catch {} }
}
