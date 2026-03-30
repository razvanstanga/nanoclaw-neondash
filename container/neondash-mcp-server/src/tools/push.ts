import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig } from '../config.js';

export function registerPushTools(server: McpServer): void {

server.tool(
    'nd_push_send',
    `Send a push notification to the user's device via NeonDash-Push.

Use when the user explicitly asks to be reminded or notified about something.
Omit tileId/dashboardId to deep-link back to this agent tile by default.`,
    {
        title:       z.string().max(100).describe('Notification title'),
        body:        z.string().max(300).describe('Notification body text'),
        sound:       z.enum(['default', 'none', 'chime', 'alert', 'ping', 'alarm']).optional(),
        tileId:      z.string().optional().describe('Override deep-link target tile ID'),
        dashboardId: z.string().optional().describe('Override deep-link target dashboard ID'),
    },
    async (args) => {
        try {
            const serviceUrl = process.env['ND_PUSH_SERVICE_URL'];
            const appToken   = process.env['ND_PUSH_APP_TOKEN'] ?? '';
            if (!serviceUrl) throw new Error('ND_PUSH_SERVICE_URL is not configured.');

            const cfg         = readConfig();
            const selfTileId  = args.tileId      ?? cfg.push?.selfTileId;
            const selfDashId  = args.dashboardId ?? cfg.push?.selfDashboardId;

            const res = await fetch(`${serviceUrl}/api/messages`, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${appToken}`,
                },
                body: JSON.stringify({
                    title:       args.title,
                    body:        args.body,
                    sound:       args.sound,
                    tileId:      selfTileId,
                    dashboardId: selfDashId,
                    clickAction: selfTileId ? 'OPEN_TILE' : undefined,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} POST ${serviceUrl}/api/messages`);
            return { content: [{ type: 'text' as const, text: 'Push notification sent.' }] };
        } catch (err) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
    },
);

} // end registerPushTools
