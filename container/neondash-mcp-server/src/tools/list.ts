import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTileEntry } from '../config.js';
import { ndGet, ndCmd, ndSearch, pick } from '../http.js';
import type { ListItem, ListConfig, ListResponse } from '../types.js';

export function registerListTools(server: McpServer): void {

server.tool(
    'nd_list_get',
    `Get list items for a NeonDash-List tile.

Returns items, available tags/labels, and current config (selectedTags, selectedLabels, pageSize).
Items are pre-filtered by the tile's active tag/label config. Use nd_list_search for text search.`,
    {
        tile:    z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        starred: z.boolean().optional().describe('When true, return only starred items'),
        unread:  z.boolean().optional().describe('When true, return only unread items'),
        limit:   z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            const data  = await ndGet(entry.serviceUrl, entry.id, entry.authHeaders) as ListResponse;
            let items: ListItem[] = data.items ?? [];
            if (args.starred) items = items.filter(i => i.starred);
            if (args.unread)  items = items.filter(i => !i.read);
            const limit = args.limit ?? 50;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile:            args.tile ?? entry.id,
                tileId:          entry.id,
                total:           items.length,
                unreadCount:     items.filter(i => !i.read).length,
                availableTags:   data.availableTags   ?? [],
                availableLabels: data.availableLabels ?? [],
                config:          data.config          ?? {},
                items: pick(items.slice(0, limit), ['id','title','description','label','tags','date','expiry','read','starred','color']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_list_search',
    `Search list items for a NeonDash-List tile.

Supports field:text syntax: title:angular, description:urgent, label:BBC, tag:sport, or plain text for all fields.
Multiple terms are AND-combined: tag:sport title:cup
Returns server-filtered results — not limited by pageSize.`,
    {
        tile:  z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        query: z.string().describe('Search query — plain text or field:text syntax'),
        limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            const items = await ndSearch<ListItem>(entry.serviceUrl, entry.id, args.query, entry.authHeaders);
            const limit = args.limit ?? 100;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                query: args.query,
                total: items.length,
                items: pick(items.slice(0, limit), ['id','title','description','label','tags','date','expiry','read','starred','color']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_list_set_config',
    `Set the display config for a NeonDash-List tile.

Persists selectedTags, selectedLabels, and pageSize server-side.
Items will be filtered to the selected tags/labels on every subsequent GET.
Pass empty arrays to clear tag/label filters.`,
    {
        tile:           z.string().optional(),
        selectedTags:   z.array(z.string()).optional().describe('Tags to filter by (empty array = no filter)'),
        selectedLabels: z.array(z.string()).optional().describe('Labels to filter by (empty array = no filter)'),
        pageSize:       z.number().int().min(1).max(500).optional().describe('Max items returned per response'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            const config: ListConfig = {};
            if (args.selectedTags   !== undefined) config.selectedTags   = args.selectedTags;
            if (args.selectedLabels !== undefined) config.selectedLabels = args.selectedLabels;
            if (args.pageSize       !== undefined) config.pageSize       = args.pageSize;
            await ndCmd(entry.serviceUrl, entry.id, { action: 'set_config', config }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'List config updated.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_list_empty',
    `Delete all non-starred items from a NeonDash-List tile.

WARNING: This is a destructive operation. Starred items are preserved; all other items are permanently deleted.
The tile's tag and label sets are rebuilt from the surviving starred items.
Only use this when the user explicitly asks to clear or empty the list.`,
    {
        tile: z.string().optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, { action: 'empty' }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'All non-starred items deleted. Starred items preserved.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_list_mark_read',
    `Mark list items as read or unread. Omit itemIds to mark all as read.`,
    {
        tile:    z.string().optional(),
        itemIds: z.array(z.string()).optional(),
        read:    z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            if (!args.itemIds?.length) {
                await ndCmd(entry.serviceUrl, entry.id, { action: 'mark_all_read' }, entry.authHeaders);
                return { content: [{ type: 'text' as const, text: 'All items marked as read.' }] };
            }
            const action = args.read !== false ? 'mark_read' : 'mark_unread';
            for (const itemId of args.itemIds) {
                await ndCmd(entry.serviceUrl, entry.id, { action, itemId }, entry.authHeaders);
            }
            return { content: [{ type: 'text' as const, text: `Marked ${args.itemIds.length} item(s) as ${args.read !== false ? 'read' : 'unread'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_list_mark_starred',
    `Star or unstar a list item.`,
    {
        tile:    z.string().optional(),
        itemId:  z.string(),
        starred: z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('list', args.tile);
            const action = args.starred ? 'mark_starred' : 'mark_unstarred';
            await ndCmd(entry.serviceUrl, entry.id, { action, itemId: args.itemId }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Item ${args.starred ? 'starred' : 'unstarred'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerListTools
