import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTileEntry } from '../config.js';
import { ndGet, ndCmd, ndSearch, pick } from '../http.js';
import type { TodoItem, TodoResponse, TodoReminder, RecurrenceRule } from '../types.js';

const TODO_COLORS = ['#39ff86','#ff6b6b','#ffd93d','#6bcbff','#ff9f43','#a29bfe','#fd79a8','#00cec9','#e17055','#636e72'];

type TodoUpdatePayload = {
    id: string;
    title?: string;
    description?: string;
    tags?: string[];
    date?: string;
    done?: boolean;
    important?: boolean;
    color?: string;
    reminders?: TodoReminder[];
    recurrence?: RecurrenceRule | null;
};

const reminderSchema = z.object({
    id:     z.string().describe('Pre-generated UUID'),
    amount: z.number().int().min(1),
    unit:   z.enum(['minutes', 'hours', 'days', 'weeks', 'months']),
});

const recurrenceSchema = z.object({
    freq:           z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval:       z.number().int().min(1).optional(),
    daysOfWeek:     z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth:     z.number().int().min(1).max(31).optional(),
    endDate:        z.string().optional().describe('YYYY-MM-DD'),
    maxOccurrences: z.number().int().min(1).optional(),
});

export function registerTodoTools(server: McpServer): void {

server.tool(
    'nd_todo_get',
    `Get todo items for a NeonDash-ToDo tile.

Returns the most recent items sorted: pending first, important-pending before normal-pending,
then by due date ascending, undated last, done items last.
Use nd_todo_search for keyword search across all items.`,
    {
        tile:      z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        done:      z.boolean().optional().describe('Filter by done state'),
        important: z.boolean().optional().describe('Filter by important flag'),
        tag:       z.string().optional().describe('Filter by tag'),
        limit:     z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            const data  = await ndGet(entry.serviceUrl, entry.id, entry.authHeaders) as TodoResponse;
            let items: TodoItem[] = data.items ?? [];
            if (args.done      !== undefined) items = items.filter(i => i.done      === args.done);
            if (args.important !== undefined) items = items.filter(i => !!i.important === args.important);
            if (args.tag) items = items.filter(i => i.tags?.includes(args.tag!));
            const limit = args.limit ?? 50;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                total: items.length,
                items: pick(items.slice(0, limit), ['id','title','description','tags','date','done','important','color','reminders','recurrence']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_search',
    `Search all todo items for a NeonDash-ToDo tile by keyword.

Searches title, description, and tags (case-insensitive). Returns ALL matching items with no 30-item cap.`,
    {
        tile:  z.string().optional().describe('Tile name or ID. Defaults to this agent tile.'),
        query: z.string().describe('Search query'),
        limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            const items = await ndSearch<TodoItem>(entry.serviceUrl, entry.id, args.query, entry.authHeaders);
            const limit = args.limit ?? 100;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                tile: args.tile ?? entry.id, tileId: entry.id,
                query: args.query,
                total: items.length,
                items: pick(items.slice(0, limit), ['id','title','description','tags','date','done','important','color','reminders','recurrence']),
                truncated: items.length > limit,
            }, null, 2) }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_add',
    `Add a new todo item to a NeonDash-ToDo tile.

Color presets: #39ff86 (green), #ff6b6b (red), #ffd93d (yellow), #6bcbff (blue),
#ff9f43 (orange), #a29bfe (purple), #fd79a8 (pink), #00cec9 (teal), #e17055 (coral), #636e72 (grey).

Reminders: array of { id (UUID), amount (number), unit (minutes|hours|days|weeks|months) }.
The server computes scheduledAt and registers with NeonDash-Push automatically.
A date field is required on the item for reminders to work.

Recurrence: { freq (daily|weekly|monthly|yearly), interval?, daysOfWeek?, dayOfMonth?, endDate?, maxOccurrences? }.
When the item is marked done, the server spawns the next occurrence automatically.`,
    {
        tile:        z.string().optional(),
        title:       z.string(),
        description: z.string().optional(),
        tags:        z.array(z.string()).optional(),
        date:        z.string().optional().describe('YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour clock). Required for reminders.'),
        important:   z.boolean().optional().describe('Flag as important — floats above other pending items'),
        color:       z.string().optional().describe('One of the 10 preset hex colours. Defaults to #636e72 (grey).'),
        reminders:   z.array(reminderSchema).optional().describe('Push notification reminders before the due date'),
        recurrence:  recurrenceSchema.optional().describe('Recurring rule — spawns next occurrence on toggle_done'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            const color = (args.color && TODO_COLORS.includes(args.color)) ? args.color : '#636e72';
            const id = crypto.randomUUID();
            const item: TodoItem = {
                id,
                title:       args.title,
                description: args.description,
                tags:        args.tags,
                date:        args.date,
                important:   args.important ?? false,
                color,
                done:        false,
            };
            if (args.reminders)  item.reminders  = args.reminders;
            if (args.recurrence) item.recurrence = args.recurrence;
            await ndCmd(entry.serviceUrl, entry.id, { action: 'add', item }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Todo added with ID: ${id}` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_update',
    `Update an existing todo item in a NeonDash-ToDo tile.

Only include the fields you want to change — the server merges the update with the existing item.

When date changes, the server automatically cancels and re-registers all reminders with the new scheduledAt.
Passing reminders: [] cancels all existing reminders for this item.
Pass recurrence: null to remove recurrence from the item.`,
    {
        tile:        z.string().optional(),
        itemId:      z.string().describe('ID of the item to update'),
        title:       z.string().optional(),
        description: z.string().optional(),
        tags:        z.array(z.string()).optional(),
        date:        z.string().optional().describe('YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour clock)'),
        important:   z.boolean().optional(),
        color:       z.string().optional().describe('One of the 10 preset hex colours'),
        done:        z.boolean().optional(),
        reminders:   z.array(reminderSchema).optional().describe('Replaces the full reminders array. Pass [] to remove all reminders.'),
        recurrence:  recurrenceSchema.nullish().describe('Pass null to remove recurrence'),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            const item: TodoUpdatePayload = { id: args.itemId };
            if (args.title       !== undefined) item.title       = args.title;
            if (args.description !== undefined) item.description = args.description;
            if (args.tags        !== undefined) item.tags        = args.tags;
            if (args.date        !== undefined) item.date        = args.date;
            if (args.important   !== undefined) item.important   = args.important;
            if (args.done        !== undefined) item.done        = args.done;
            if (args.reminders   !== undefined) item.reminders   = args.reminders;
            if (args.recurrence  !== undefined) item.recurrence  = args.recurrence ?? null;
            if (args.color !== undefined) {
                item.color = TODO_COLORS.includes(args.color) ? args.color : '#636e72';
            }
            await ndCmd(entry.serviceUrl, entry.id, { action: 'update', item }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'Todo updated.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_toggle_done',
    `Toggle the done state of a todo item.

When marking done on a recurring item, the server automatically creates the next occurrence.`,
    {
        tile:   z.string().optional(),
        itemId: z.string(),
        done:   z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, {
                action: 'toggle_done',
                itemId: args.itemId,
                done:   args.done,
            }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Todo marked as ${args.done ? 'done' : 'undone'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_toggle_important',
    `Flag or unflag a todo item as important.

Important items sort above other pending items in the tile.`,
    {
        tile:      z.string().optional(),
        itemId:    z.string(),
        important: z.boolean().default(true),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, {
                action:    'toggle_important',
                itemId:    args.itemId,
                important: args.important,
            }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: `Todo ${args.important ? 'flagged as important' : 'unflagged'}.` }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

server.tool(
    'nd_todo_delete',
    `Delete a todo item (soft-delete — sets _deleted: true in Redis). Attachment files are removed from disk.`,
    {
        tile:   z.string().optional(),
        itemId: z.string(),
    },
    async (args) => {
        try {
            const entry = resolveTileEntry('todo', args.tile);
            await ndCmd(entry.serviceUrl, entry.id, { action: 'delete', itemId: args.itemId }, entry.authHeaders);
            return { content: [{ type: 'text' as const, text: 'Todo deleted.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerTodoTools
