import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTileEntry, readConfig } from '../config.js';
import { ndGet, ndCmd, ndSearch, pick, openUrl } from '../http.js';
import type { RssItem, RssFeed, RssResponse, InteractionEntry, RecContextUnreadItem, RecContextResponse } from '../types.js';

function safeDate(s?: string): string {
    if (!s) return '';
    try { return new Date(s).toISOString().slice(0, 10); } catch { return ''; }
}

export function registerRssTools(server: McpServer): void {

server.tool(
    'nd_rss_get',
    `Get RSS articles for a NeonDash-RSS tile.

Returns recent articles sorted unread-first then newest-first (capped by the tile's itemsPerPage setting).
For full-archive search use nd_rss_search instead.`,
    {
        tile:    z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        starred: z.boolean().optional().describe('When true, return only starred items'),
        unread:  z.boolean().optional().describe('When true, return only unread items'),
        limit:   z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss', args.tile);
            const data  = await ndGet(entry.serviceUrl, entry.id, entry.authHeaders) as RssResponse;
            let items: RssItem[] = data.items ?? [];
            if (args.starred) items = items.filter(i => i.starred);
            if (args.unread)  items = items.filter(i => !i.read);
            const limit = args.limit ?? 50;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                total: items.length,
                unreadCount: items.filter(i => !i.read).length,
                items: items.slice(0, limit).map(i => ({
                    id:        i.id,
                    title:     i.title,
                    description: i.description,
                    link:      openUrl(entry.serviceUrl, entry.id, i.id),
                    pubDate:   i.pubDate,
                    feedLabel: i.feedLabel,
                    feedId:    i.feedId,
                    read:      i.read,
                    starred:   i.starred,
                })),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_search',
    `Search the full RSS article archive for a NeonDash-RSS tile.

Searches across ALL stored articles — not limited to the current live feed.
Searches title, description, and feedLabel (case-insensitive substring).`,
    {
        tile:  z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        query: z.string().describe('Search terms — e.g. "angular", "BBC climate"'),
        limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss', args.tile);
            const items = await ndSearch<RssItem>(entry.serviceUrl, entry.id, args.query, entry.authHeaders);
            const limit = args.limit ?? 100;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                query: args.query,
                total: items.length,
                items: items.slice(0, limit).map(i => ({
                    id:          i.id,
                    title:       i.title,
                    description: i.description,
                    link:        openUrl(entry.serviceUrl, entry.id, i.id),
                    pubDate:     i.pubDate,
                    feedLabel:   i.feedLabel,
                    feedId:      i.feedId,
                    read:        i.read,
                    starred:     i.starred,
                })),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_get_feeds',
    `Get the list of RSS feeds configured for a NeonDash-RSS tile.

Returns each feed's id, url, label, active state, and push notification setting.`,
    {
        tile: z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss', args.tile);
            const data  = await ndGet(entry.serviceUrl, entry.id, entry.authHeaders) as RssResponse;
            const feeds: RssFeed[] = data.feeds ?? [];
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                count: feeds.length,
                feeds: feeds.map(f => ({
                    id:          f.id,
                    url:         f.url,
                    label:       f.label ?? f.title ?? f.url,
                    active:      f.active,
                    pushEnabled: f.pushEnabled ?? true,
                })),
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_mark_read',
    `Mark RSS articles as read or unread. Omit itemIds to mark all as read.`,
    {
        tile:    z.string().optional(),
        itemIds: z.array(z.string()).optional(),
        read:    z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss', args.tile);
            if (!args.itemIds?.length) {
                await ndCmd(entry.serviceUrl, entry.id, { action: 'mark_all_read' }, entry.authHeaders);
                return { content: [{ type: 'text' as const, text: 'All articles marked as read.' }] };
            }
            const action = args.read !== false ? 'mark_read' : 'mark_unread';
            for (const itemId of args.itemIds) {
                await ndCmd(entry.serviceUrl, entry.id, { action, itemId }, entry.authHeaders);
            }
            return { content: [{ type: 'text' as const, text: `Marked ${args.itemIds.length} article(s) as ${args.read !== false ? 'read' : 'unread'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_mark_starred',
    `Star or unstar an RSS article.

Starred articles are retained permanently in Redis — they never expire.`,
    {
        tile:    z.string().optional(),
        itemId:  z.string(),
        starred: z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss', args.tile);
            const action = args.starred ? 'mark_starred' : 'mark_unstarred';
            await ndCmd(entry.serviceUrl, entry.id, { action, itemId: args.itemId }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Article ${args.starred ? 'starred' : 'unstarred'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_get_interactions',
    `Fetch the user's long-term RSS interaction history (explicit reads and stars).

Use this to understand reading preferences before generating recommendations.
Results are newest-first and never expire — the full history is available.`,
    {
        tileId: z.string().optional().describe('Filter interactions from a specific tile ID only. Omit for all tiles.'),
        action: z.enum(['read', 'star', 'unstar']).optional().describe('Filter by action type'),
        limit:  z.number().int().min(1).max(2000).default(300),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('rss');
            const qs = new URLSearchParams({ limit: String(args.limit) });
            if (args.tileId) qs.set('tileId', args.tileId);
            if (args.action) qs.set('action', args.action);
            const url = `${entry.serviceUrl}/api/interactions?${qs}`;
            const res = await fetch(url, { headers: { ...(entry.authHeaders ?? {}) } });
            if (!res.ok) throw new Error(`HTTP ${res.status} GET ${url}`);
            const data = await res.json() as { interactions: InteractionEntry[]; total: number };
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                total:        data.total,
                interactions: data.interactions,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_rss_get_rec_context',
    `Get a token-efficient recommendation context bundle.

Returns condensed interaction history (reading patterns) + current unread article headlines with short descriptions and links.
Call this ONCE at the start of a recommendation or briefing session — it covers everything needed in a single call.
Descriptions are capped at 200 chars. For full article content, call nd_rss_get on the relevant tile.`,
    {
        interactionLimit: z.number().int().min(1).max(2000).default(200),
        unreadLimit:      z.number().int().min(1).max(200).default(40),
    },
    async (args) => {
        try {
            const cfg   = readConfig();
            const tiles = (cfg.rss?.tiles ?? []).filter(t => t.mcpEnabled && !!t.serviceUrl);
            if (!tiles.length) throw new Error('No RSS tiles configured. Enable at least one RSS tile in agent settings.');

            const baseTile = tiles[0];

            const qs = new URLSearchParams({ limit: String(args.interactionLimit) });
            const intUrl = `${baseTile.serviceUrl}/api/interactions?${qs}`;
            const intRes = await fetch(intUrl, { headers: { ...(baseTile.authHeaders ?? {}) } });
            if (!intRes.ok) throw new Error(`HTTP ${intRes.status} GET ${intUrl}`);
            const intData = await intRes.json() as { interactions: InteractionEntry[]; total: number };

            const stripped = intData.interactions.map(({ tileId: _tid, ...rest }) => rest);

            const totalUnreadLimit = args.unreadLimit;
            const allUnread: RecContextUnreadItem[] = [];

            for (const tile of tiles) {
                if (allUnread.length >= totalUnreadLimit) break;
                const data = await ndGet(tile.serviceUrl, tile.id, tile.authHeaders) as RssResponse;
                for (const item of (data.items ?? []).filter((i: RssItem) => !i.read)) {
                    allUnread.push({
                        feed:  item.feedLabel    ?? '',
                        title: item.title        ?? '',
                        date:  safeDate(item.pubDate),
                        desc:  (item.description ?? '').slice(0, 200),
                        link:  openUrl(tile.serviceUrl, tile.id, item.id),
                    });
                    if (allUnread.length >= totalUnreadLimit) break;
                }
            }

            const result: RecContextResponse = {
                interactions: stripped,
                unread:       allUnread,
                stats:        { totalInteractions: intData.total, totalUnread: allUnread.length },
                generatedAt:  new Date().toISOString(),
            };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerRssTools
