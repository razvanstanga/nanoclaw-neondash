import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSetupTools } from './tools/setup.js';
import { registerRssTools }   from './tools/rss.js';
import { registerTodoTools }  from './tools/todo.js';
import { registerNotesTools } from './tools/notes.js';
import { registerListTools }  from './tools/list.js';
import { registerPushTools }  from './tools/push.js';

const server = new McpServer({
    name:    'neondash',
    version: '1.3.0',
});

registerSetupTools(server);
registerRssTools(server);
registerTodoTools(server);
registerNotesTools(server);
registerListTools(server);
if (process.env['ND_PUSH_SERVICE_URL']) registerPushTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
