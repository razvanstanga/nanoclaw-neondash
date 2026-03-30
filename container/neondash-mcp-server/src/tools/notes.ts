import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTileEntry } from '../config.js';
import { ndGet, ndCmd, ndSearch, pick } from '../http.js';
import type { NoteItem, NotesConfig, NotesResponse } from '../types.js';

const NOTE_COLORS = ['#39ff86','#ff6b6b','#ffd93d','#6bcbff','#ff9f43','#a29bfe','#fd79a8','#00cec9','#e17055','#636e72'];

type NoteUpdatePayload = {
    id: string;
    title?: string;
    body?: string;
    tags?: string[];
    important?: boolean;
    color?: string;
};

export function registerNotesTools(server: McpServer): void {

server.tool(
    'nd_notes_get',
    `Get notes for a NeonDash-Notes tile.

Notes are sorted: important first, then newest first by createdAt.
Use nd_notes_search for keyword search.`,
    {
        tile:      z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        tag:       z.string().optional().describe('Filter by tag'),
        important: z.boolean().optional().describe('Filter by important flag'),
        limit:     z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            const data  = await ndGet(entry.serviceUrl, entry.id, entry.authHeaders) as NotesResponse;
            let items: NoteItem[] = data.items ?? [];
            if (args.tag)                    items = items.filter(i => i.tags?.includes(args.tag!));
            if (args.important !== undefined) items = items.filter(i => !!i.important === args.important);
            const limit = args.limit ?? 50;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                total: items.length,
                items: pick(items.slice(0, limit), ['id','title','body','tags','color','important','createdAt','updatedAt']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_search',
    `Search notes in a NeonDash-Notes tile by keyword.

Searches title, body, and tags (case-insensitive substring). Server returns all matching notes.`,
    {
        tile:  z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        query: z.string().describe('Search query'),
        limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            const items = await ndSearch<NoteItem>(entry.serviceUrl, entry.id, args.query, entry.authHeaders);
            const limit = args.limit ?? 100;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                query: args.query,
                total: items.length,
                items: pick(items.slice(0, limit), ['id','title','body','tags','color','important','createdAt','updatedAt']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_add',
    `Add a new note to a NeonDash-Notes tile.

Color presets: #39ff86 (green), #ff6b6b (red), #ffd93d (yellow), #6bcbff (blue),
#ff9f43 (orange), #a29bfe (purple), #fd79a8 (pink), #00cec9 (teal), #e17055 (coral), #636e72 (grey).`,
    {
        tile:      z.string().optional(),
        title:     z.string(),
        body:      z.string().optional().describe('Multi-line note body'),
        tags:      z.array(z.string()).optional(),
        important: z.boolean().optional().describe('Flag as important — floats above other notes'),
        color:     z.string().optional().describe('One of the 10 preset hex colours. Defaults to #636e72 (grey).'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            const color = (args.color && NOTE_COLORS.includes(args.color)) ? args.color : '#636e72';
            const id = crypto.randomUUID();
            const item: NoteItem = {
                id,
                title:     args.title,
                body:      args.body,
                tags:      args.tags,
                important: args.important ?? false,
                color,
            };
            await ndCmd(entry.serviceUrl, entry.id, { action: 'add', item }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Note added with ID: ${id}` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_update',
    `Update an existing note in a NeonDash-Notes tile.

Partial update — only include fields you want to change. The server merges the update.`,
    {
        tile:      z.string().optional(),
        itemId:    z.string().describe('ID of the note to update'),
        title:     z.string().optional(),
        body:      z.string().optional(),
        tags:      z.array(z.string()).optional(),
        important: z.boolean().optional(),
        color:     z.string().optional().describe('One of the 10 preset hex colours'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            const item: NoteUpdatePayload = { id: args.itemId };
            if (args.title     !== undefined) item.title     = args.title;
            if (args.body      !== undefined) item.body      = args.body;
            if (args.tags      !== undefined) item.tags      = args.tags;
            if (args.important !== undefined) item.important = args.important;
            if (args.color !== undefined) {
                item.color = NOTE_COLORS.includes(args.color) ? args.color : '#636e72';
            }
            await ndCmd(entry.serviceUrl, entry.id, { action: 'update', item }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'Note updated.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_toggle_important',
    `Flag or unflag a note as important.

Important notes sort to the top of the tile.`,
    {
        tile:      z.string().optional(),
        itemId:    z.string(),
        important: z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, {
                action:    'toggle_important',
                itemId:    args.itemId,
                important: args.important,
            }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Note ${args.important ? 'flagged as important' : 'unflagged'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_delete',
    `Delete a note from a NeonDash-Notes tile (hard-delete — permanently removed from Redis).`,
    {
        tile:   z.string().optional(),
        itemId: z.string(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, { action: 'delete', itemId: args.itemId }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'Note deleted.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_notes_save_config',
    `Save transcription config for a NeonDash-Notes tile.

Controls voice transcription settings — Wisper URL, token, enable flag, and max recording duration.
Only affects the tile's transcription UI; does not change stored notes.`,
    {
        tile:                 z.string().optional(),
        transcribeEnabled:    z.boolean().optional(),
        transcribeMaxSeconds: z.number().int().min(5).max(300).optional(),
        wisperUrl:            z.string().optional().describe('Base URL of the NeonDash-Wisper service'),
        wisperToken:          z.string().optional().describe('Optional API token for Wisper (X-API-Token header)'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('notes', args.tile);
            const config: NotesConfig = {};
            if (args.transcribeEnabled    !== undefined) config.transcribeEnabled    = args.transcribeEnabled;
            if (args.transcribeMaxSeconds !== undefined) config.transcribeMaxSeconds = args.transcribeMaxSeconds;
            if (args.wisperUrl            !== undefined) config.wisperUrl            = args.wisperUrl;
            if (args.wisperToken          !== undefined) config.wisperToken          = args.wisperToken;
            await ndCmd(entry.serviceUrl, entry.id, { action: 'save_config', config }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'Notes config saved.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerNotesTools
