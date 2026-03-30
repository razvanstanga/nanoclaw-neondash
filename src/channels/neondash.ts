import fs from 'fs';
import http from 'http';
import path from 'path';

import { Server, Socket } from 'socket.io';

import { GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { Channel, RegisteredGroup } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const ND_JID_PREFIX = 'nd_';
const COMMAND_EVENT = 'nd_command';
const HISTORY_LIMIT = 200;

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'complete' | 'error';
  imagePath?: string;
}

interface McpTileEntry {
  id: string;
  name: string;
  serviceUrl: string;
  authHeaders?: Record<string, string>;
  mcpEnabled: boolean;
}

interface AgentMcpConfig {
  rss?: { tiles: McpTileEntry[] };
  todo?: { tiles: McpTileEntry[] };
  notes?: { tiles: McpTileEntry[] };
  list?: { tiles: McpTileEntry[] };
}

interface AgentPushConfig {
  selfTileId: string;
  selfDashboardId: string;
}

interface AgentQuickAction {
  id: string;
  title: string;
  prompt: string;
  automatic: boolean;
  enabled: boolean;
}

interface AgentTileConfig {
  systemPrompt?: string;
  assistantName?: string;
  containerImage?: string;
  responseFormat?: 'html' | 'markdown';
  mcpServices?: AgentMcpConfig;
  quickActions?: AgentQuickAction[];
  pushConfig?: AgentPushConfig;
}

type NdCommand =
  | { tileId: string; action: 'subscribe' }
  | {
      tileId: string;
      action: 'message';
      id?: string;
      text: string;
      image?: { data: string; mimeType: string };
    }
  | { tileId: string; action: 'clear_session' }
  | {
      tileId: string;
      action: 'set_config';
      config: {
        systemPrompt?: string;
        assistantName?: string;
        responseFormat?: 'html' | 'markdown';
        mcpServices?: AgentMcpConfig;
        quickActions?: AgentQuickAction[];
        pushConfig?: AgentPushConfig;
      };
    };

function jid(tileId: string): string {
  return `${ND_JID_PREFIX}${tileId}`;
}
function tid(j: string): string {
  return j.startsWith(ND_JID_PREFIX) ? j.slice(ND_JID_PREFIX.length) : j;
}
function valueEvent(t: string): string {
  return `nd_agent_${t}`;
}
function mkId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export class NeonDashChannel implements Channel {
  readonly name = 'neondash';

  private io: Server | null = null;
  private httpServer: http.Server | null = null;
  private running = false;
  private tileSockets = new Map<string, Set<Socket>>();

  constructor(
    private readonly opts: ChannelOpts,
    private readonly port: number,
    private readonly authToken: string | null,
    private readonly defaultFormat: 'html' | 'markdown' = 'html',
  ) {}

  async connect(): Promise<void> {
    this.httpServer = http.createServer();
    this.io = new Server(this.httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    if (this.authToken) {
      this.io.use((socket, next) => {
        if (socket.handshake.auth?.token === this.authToken) return next();
        logger.warn(
          { socketId: socket.id },
          'NeonDash: rejected unauthenticated connection',
        );
        next(new Error('Unauthorized'));
      });
    }

    this.io.on('connection', (socket) => this.onConnect(socket));

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.port, () => {
        this.running = true;
        logger.info({ port: this.port }, 'NeonDash Socket.IO server started');
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    this.running = false;
    await new Promise<void>((resolve) => this.io?.close(() => resolve()));
    logger.info('NeonDash Socket.IO server stopped');
  }

  isConnected(): boolean {
    return this.running;
  }

  ownsJid(j: string): boolean {
    return j.startsWith(ND_JID_PREFIX);
  }

  async sendMessage(j: string, text: string): Promise<void> {
    const t = tid(j);
    const msg: AgentMessage = {
      id: mkId('asst'),
      role: 'assistant',
      text,
      timestamp: Date.now(),
      status: 'complete',
    };
    this.appendHistory(t, msg);
    this.emitToTile(t, { type: 'message', message: msg });
    logger.debug(
      { tileId: t, textLen: text.length },
      'NeonDash: sent assistant message',
    );
  }

  async setTyping(j: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    this.emitToTile(tid(j), { type: 'thinking' });
  }

  private onConnect(socket: Socket): void {
    logger.debug({ socketId: socket.id }, 'NeonDash: client connected');

    socket.on(
      COMMAND_EVENT,
      async (payload: unknown, ack?: (...args: unknown[]) => void) => {
        try {
          await this.dispatch(socket, payload as NdCommand, ack);
        } catch (err) {
          logger.error({ err, payload }, 'NeonDash: unhandled command error');
          ack?.({ error: 'Internal error' });
        }
      },
    );

    socket.on('disconnect', (reason) => {
      for (const [t, sockets] of this.tileSockets) {
        sockets.delete(socket);
        if (sockets.size === 0) this.tileSockets.delete(t);
      }
      logger.debug(
        { socketId: socket.id, reason },
        'NeonDash: client disconnected',
      );
    });
  }

  private async dispatch(
    socket: Socket,
    payload: NdCommand,
    ack?: (...args: unknown[]) => void,
  ): Promise<void> {
    const { tileId: t, action } = payload ?? ({} as NdCommand);

    if (!t || !action) {
      ack?.({ error: 'Missing tileId or action' });
      return;
    }

    switch (action) {
      case 'subscribe':
        return this.doSubscribe(socket, t);
      case 'message':
        return this.doMessage(
          socket,
          t,
          payload as Extract<NdCommand, { action: 'message' }>,
          ack,
        );
      case 'clear_session':
        return this.doClearSession(socket, t);
      case 'set_config':
        return this.doSetConfig(
          socket,
          t,
          payload as Extract<NdCommand, { action: 'set_config' }>,
        );
      default:
        logger.warn({ action, tileId: t }, 'NeonDash: unknown action');
        ack?.({ error: `Unknown action: ${action as string}` });
    }
  }

  private doSubscribe(socket: Socket, t: string): void {
    let sockets = this.tileSockets.get(t);
    if (!sockets) {
      sockets = new Set();
      this.tileSockets.set(t, sockets);
    }
    sockets.add(socket);

    this.ensureGroup(t);

    const messages = this.resolveImages(t, this.loadHistory(t)).map(
      ({ imagePath: _, ...rest }) => rest,
    );
    const config = this.loadConfig(t);
    const response: Record<string, unknown> = { type: 'history', messages };
    if (config) response['config'] = config;
    socket.emit(valueEvent(t), response);

    logger.info({ tileId: t }, 'NeonDash: tile subscribed');
  }

  private async doMessage(
    socket: Socket,
    t: string,
    payload: Extract<NdCommand, { action: 'message' }>,
    ack?: (...args: unknown[]) => void,
  ): Promise<void> {
    const text = (payload.text ?? '').trim();
    const image = payload.image;

    if (!text && !image) {
      ack?.({ error: 'Empty message' });
      return;
    }

    ack?.({ received: true });

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const id = uuidRe.test(payload.id ?? '') ? payload.id! : mkId('usr');
    const now = new Date().toISOString();
    const j = jid(t);

    const userMsg: AgentMessage = {
      id,
      role: 'user',
      text: text || '',
      timestamp: Date.now(),
      status: 'sent',
    };

    let content = text;
    if (image) {
      const imgPath = this.saveImage(t, id, image);
      userMsg.imagePath = path.basename(imgPath);
      const containerPath = `/workspace/group/images/${userMsg.imagePath}`;
      content = `[Image attached at: ${containerPath}]\n${text}`.trim();
    }

    this.appendHistory(t, userMsg);

    const [resolved] = this.resolveImages(t, [userMsg]);
    const { imagePath: _, ...msgForClient } = resolved;
    this.emitToTile(t, { type: 'user_message', message: msgForClient });

    this.opts.onChatMetadata(j, now, `NeonDash ${t}`, 'neondash', false);

    this.opts.onMessage(j, {
      id,
      chat_jid: j,
      sender: j,
      sender_name: 'User',
      content,
      timestamp: now,
      is_from_me: false,
      is_bot_message: false,
    });

    logger.info({ tileId: t, hasImage: !!image }, 'NeonDash: message stored');
  }

  private doClearSession(_socket: Socket, t: string): void {
    this.saveHistory(t, []);
    this.opts.clearGroupSession?.(`nd_${t}`);
    try {
      fs.rmSync(path.join(this.groupDir(t), 'images'), {
        recursive: true,
        force: true,
      });
    } catch {}
    this.emitToTile(t, { type: 'history', messages: [] });
    logger.info({ tileId: t }, 'NeonDash: session cleared');
  }

  private doSetConfig(
    _socket: Socket,
    t: string,
    payload: Extract<NdCommand, { action: 'set_config' }>,
  ): void {
    const incoming = payload.config ?? {};
    const prev = this.loadConfig(t) ?? {};

    const updated: AgentTileConfig = {
      ...prev,
      ...(incoming.systemPrompt !== undefined && {
        systemPrompt: incoming.systemPrompt,
      }),
      ...(incoming.assistantName !== undefined && {
        assistantName: incoming.assistantName,
      }),
      ...(incoming.responseFormat !== undefined && {
        responseFormat: incoming.responseFormat,
      }),
      ...(incoming.mcpServices !== undefined && {
        mcpServices: incoming.mcpServices,
      }),
      ...(incoming.quickActions !== undefined && {
        quickActions: incoming.quickActions,
      }),
      ...(incoming.pushConfig !== undefined && {
        pushConfig: incoming.pushConfig,
      }),
    };
    this.saveConfig(t, updated);
    this.writeClaudeMd(t, updated);

    if (
      incoming.assistantName &&
      incoming.assistantName !== prev.assistantName
    ) {
      const announcement: AgentMessage = {
        id: mkId('system'),
        role: 'assistant',
        text: `<p>Your handle is now <strong>${incoming.assistantName}</strong>.</p>`,
        timestamp: Date.now(),
        status: 'complete',
      };
      this.appendHistory(t, announcement);
      this.emitToTile(t, { type: 'message', message: announcement });
    }

    this.emitToTile(t, { type: 'config', config: updated });
    logger.info({ tileId: t }, 'NeonDash: config updated');
  }

  private ensureGroup(t: string): void {
    const j = jid(t);
    if (this.opts.registeredGroups()[j]) return;

    const config = this.loadConfig(t);
    const folder = `nd_${t}`;
    const group: RegisteredGroup = {
      name: `NeonDash ${t}`,
      folder,
      trigger: '',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
      isMain: false,
    };

    this.opts.registerGroup?.(j, group);
    this.opts.onChatMetadata(
      j,
      new Date().toISOString(),
      `NeonDash ${t}`,
      'neondash',
      false,
    );
    this.writeClaudeMd(t, config ?? {});

    logger.info({ tileId: t, folder }, 'NeonDash: auto-registered group');
  }

  /** Called by the IPC handler when the agent requests a format switch. */
  setGroupFormat(folder: string, format: 'html' | 'markdown'): void {
    if (!folder.startsWith(ND_JID_PREFIX)) return;
    const t = folder.slice(ND_JID_PREFIX.length);
    const prev = this.loadConfig(t) ?? {};
    const updated: AgentTileConfig = { ...prev, responseFormat: format };
    this.saveConfig(t, updated);
    this.writeClaudeMd(t, updated);
    this.emitToTile(t, { type: 'config', config: updated });
    logger.info(
      { tileId: t, format },
      'NeonDash: response format updated via agent',
    );
  }

  private writeClaudeMd(t: string, config: AgentTileConfig): void {
    const dir = this.groupDir(t);
    fs.mkdirSync(dir, { recursive: true });

    const name = config.assistantName ?? 'Andy';
    const format = config.responseFormat ?? this.defaultFormat;

    const header = [
      `# ${name} — NeonDash Tile Agent`,
      '',
      `You are **${name}**, an AI assistant embedded in a NeonDash smart home dashboard tile.`,
      '',
    ].join('\n');

    const formatSection =
      format === 'markdown'
        ? [
            '## Response Format',
            '',
            '**IMPORTANT**: Always respond using **Markdown**. Never output raw HTML.',
            '',
            '- Use `#`, `##`, `###` headings for structure',
            '- Use `**bold**` and `*italic*` for emphasis',
            '- Use backtick fences (` ```language `) for code blocks',
            '- Use `-` or `*` for bullet lists, `1.` for numbered lists',
            '- Use `> ` for blockquotes',
            '- Use `|` table syntax for tabular data',
            '- Keep responses concise and visually clean',
            '',
          ].join('\n')
        : [
            '## Response Format',
            '',
            '**IMPORTANT**: Always respond with semantic **HTML body content ONLY**. Never use Markdown.',
            '',
            '- Do NOT include DOCTYPE, `<html>`, `<head>`, or `<body>` tags',
            '- Do NOT use Markdown syntax (no `**bold**`, no `# headings`, no backtick fences)',
            '- Keep responses concise and visually clean',
            '',
            '### Common HTML Tags',
            '',
            '| Tag | Use for |',
            '|-----|---------|',
            '| `<p>` | Paragraphs of text |',
            '| `<h2>`, `<h3>`, `<h4>` | Section headings |',
            '| `<ul>`, `<ol>`, `<li>` | Bullet or numbered lists |',
            '| `<strong>` | Bold / important text |',
            '| `<em>` | Italic / emphasized text |',
            '| `<code>` | Inline code |',
            '| `<pre><code class="language-...">` | Code blocks |',
            '| `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` | Tables |',
            '| `<blockquote>` | Quotes or callouts |',
            '| `<hr>` | Horizontal divider |',
            '| `<br>` | Line break within a block |',
            '| `<details>` + `<summary>` | Collapsible sections |',
            '| `<a href="...">` | Links |',
            '| `<span>` | Inline wrapper for styling |',
            '',
          ].join('\n');

    const shared = [
      '## Changing Response Format',
      '',
      'If the user asks you to switch between HTML and Markdown, call `mcp__nanoclaw__set_response_format`',
      'with `format="html"` or `format="markdown"`. The change takes effect from the next message.',
      '',
      '## Sending Screenshots or Images',
      '',
      'To send a screenshot to the user:',
      '1. Create the directory and take the screenshot:',
      '   `mkdir -p /workspace/group/screenshots && agent-browser screenshot /workspace/group/screenshots/latest.png`',
      '2. Call `mcp__nanoclaw__send_screenshot` with `path=/workspace/group/screenshots/latest.png`',
      '',
      'Do NOT try to base64-encode the file yourself — use `send_screenshot` instead.',
      '',
      '## Images from the User',
      '',
      'When a message mentions `[Image attached at: /workspace/group/images/<file>]`,',
      'use the **Read** tool to examine the image at that path before replying.',
      '',
    ].join('\n');

    const custom = config.systemPrompt
      ? `## Custom Instructions\n\n${config.systemPrompt}\n`
      : '';

    let mcpSection = '';
    const mcp = config.mcpServices;
    if (mcp) {
      const SERVICE_LABELS: Record<string, string> = {
        rss: 'RSS',
        todo: 'ToDo',
        notes: 'Notes',
        list: 'List',
      };
      const parts: string[] = ['\n## NeonDash MCP Services\n'];
      parts.push(`Your agent tile ID is **\`${t}\`**.\n`);
      parts.push(
        'Access NeonDash data tools via the `mcp__neondash__*` prefix.\n',
      );
      parts.push('Only tiles explicitly enabled by the user are accessible.\n');

      let hasAny = false;
      for (const [kind, svc] of Object.entries(mcp) as [
        string,
        { tiles?: McpTileEntry[] },
      ][]) {
        if (!svc?.tiles) continue;
        const enabled = svc.tiles.filter((tile) => tile.mcpEnabled);
        if (enabled.length === 0) continue;
        hasAny = true;
        parts.push(`\n### ${SERVICE_LABELS[kind] ?? kind}`);
        parts.push(
          'Enabled tiles: ' +
            enabled.map((tile) => `"${tile.name}" (\`${tile.id}\`)`).join(', '),
        );
      }

      if (hasAny) {
        parts.push('\n### Usage examples');
        parts.push(
          '- "Summarise my Technology RSS" → `nd_rss_get` with `tile: "Technology"`',
        );
        parts.push(
          '- "Add a todo to Work list" → `nd_todo_add` with `tile: "Work"`',
        );
        parts.push(
          '- "Search Ideas notes for docker" → `nd_notes_get` with `tile: "Ideas"`',
        );
        parts.push(
          '- "Show Inventory list items" → `nd_list_get` with `tile: "Inventory"`',
        );
        mcpSection = parts.join('\n');
      }
    }

    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      header + formatSection + shared + custom + mcpSection,
      'utf-8',
    );
  }

  private groupDir(t: string): string {
    return path.join(GROUPS_DIR, `nd_${t}`);
  }

  private historyPath(t: string): string {
    return path.join(this.groupDir(t), 'nd-history.json');
  }

  private configPath(t: string): string {
    return path.join(this.groupDir(t), 'nd-config.json');
  }

  private loadHistory(t: string): AgentMessage[] {
    try {
      return JSON.parse(
        fs.readFileSync(this.historyPath(t), 'utf-8'),
      ) as AgentMessage[];
    } catch {
      return [];
    }
  }

  private saveHistory(t: string, messages: AgentMessage[]): void {
    const dir = this.groupDir(t);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.historyPath(t), JSON.stringify(messages, null, 2));
  }

  private appendHistory(t: string, msg: AgentMessage): void {
    const history = this.loadHistory(t);
    history.push(msg);
    this.saveHistory(t, history.slice(-HISTORY_LIMIT));
  }

  private loadConfig(t: string): AgentTileConfig | null {
    try {
      return JSON.parse(
        fs.readFileSync(this.configPath(t), 'utf-8'),
      ) as AgentTileConfig;
    } catch {
      return null;
    }
  }

  private saveConfig(t: string, config: AgentTileConfig): void {
    const dir = this.groupDir(t);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath(t), JSON.stringify(config, null, 2));
  }

  private saveImage(
    t: string,
    id: string,
    image: { data: string; mimeType: string },
  ): string {
    const ext =
      image.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'jpg';
    const dir = path.join(this.groupDir(t), 'images');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    logger.debug(
      { tileId: t, file, mimeType: image.mimeType },
      'NeonDash: image saved',
    );
    return file;
  }

  private resolveImages(
    t: string,
    messages: AgentMessage[],
  ): (AgentMessage & { imageDataUrl?: string })[] {
    const dir = path.join(this.groupDir(t), 'images');
    return messages.map((msg) => {
      if (!msg.imagePath) return msg;
      try {
        const data = fs.readFileSync(path.join(dir, msg.imagePath));
        const ext = path.extname(msg.imagePath).slice(1).toLowerCase();
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'webp'
                ? 'image/webp'
                : 'image/jpeg';
        return {
          ...msg,
          imageDataUrl: `data:${mime};base64,${data.toString('base64')}`,
        };
      } catch {
        return msg;
      }
    });
  }

  private emitToTile(t: string, event: Record<string, unknown>): void {
    const sockets = this.tileSockets.get(t);
    if (!sockets || sockets.size === 0) {
      logger.debug(
        { tileId: t },
        'NeonDash: no sockets for tile, dropping event',
      );
      return;
    }
    const evt = valueEvent(t);
    for (const sock of sockets) {
      sock.emit(evt, event);
    }
  }
}

registerChannel('neondash', (opts) => {
  const env = readEnvFile([
    'NEONDASH_PORT',
    'SOCKETIO_AUTH_TOKEN',
    'NEONDASH_RESPONSE_FORMAT',
  ]);
  const port = parseInt(
    process.env['NEONDASH_PORT'] ?? env['NEONDASH_PORT'] ?? '6001',
    10,
  );
  const authToken =
    process.env['SOCKETIO_AUTH_TOKEN'] ?? env['SOCKETIO_AUTH_TOKEN'] ?? null;
  const rawFormat =
    process.env['NEONDASH_RESPONSE_FORMAT'] ??
    env['NEONDASH_RESPONSE_FORMAT'] ??
    'html';
  const defaultFormat = rawFormat === 'markdown' ? 'markdown' : 'html';

  if (!authToken) {
    logger.warn(
      'NeonDash: SOCKETIO_AUTH_TOKEN is not set — server accepts unauthenticated connections',
    );
  }

  return new NeonDashChannel(opts, port, authToken, defaultFormat);
});
