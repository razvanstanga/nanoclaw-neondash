import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig } from '../config.js';

export function registerSetupTools(server: McpServer): void {

server.tool(
    'nd_list_tiles',
    `List all NeonDash tiles configured in this agent's MCP Integrations settings.
Use this to see what tiles are available, what service they belong to, and which are enabled.`,
    { service: z.enum(['rss', 'todo', 'notes', 'list', 'all']).default('all') },
    async (args) => {
        try {
            const config   = readConfig();
            const allKinds = ['rss', 'todo', 'notes', 'list'] as const;
            const kinds    = args.service === 'all' ? allKinds : [args.service as typeof allKinds[number]];
            const lines: string[] = [];

            for (const kind of kinds) {
                const group = config[kind];
                if (!group) { lines.push(`${kind.toUpperCase()}: not configured`); continue; }
                const enabled  = group.tiles.filter(t => t.mcpEnabled);
                const disabled = group.tiles.filter(t => !t.mcpEnabled);
                lines.push(`${kind.toUpperCase()}:`);
                for (const t of enabled)  lines.push(`  ✓ "${t.name}" (${t.id}) — ${t.serviceUrl}`);
                for (const t of disabled) lines.push(`  ✗ "${t.name}" (${t.id}) — disabled`);
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') || 'No tiles configured.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerSetupTools
