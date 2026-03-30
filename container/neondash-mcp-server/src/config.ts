import fs from 'fs';
import type { AgentMcpConfig, TileEntry } from './types.js';

// Path to the tile's nd-config.json. Override via NEONDASH_CONFIG_PATH.
// When running inside a NanoClaw container the default resolves automatically.
const ND_CONFIG_PATH   = process.env['NEONDASH_CONFIG_PATH'] ?? '/workspace/group/nd-config.json';
const POLL_INTERVAL_MS = 10_000;

// Cached config — loaded from NEONDASH_CONFIG env at startup, refreshed when nd-config.json mtime changes
let cachedConfig: AgentMcpConfig = (() => {
    const raw = process.env['NEONDASH_CONFIG'] ?? '{}';
    try { return JSON.parse(raw) as AgentMcpConfig; } catch { return {}; }
})();

let lastMtime = 0;

function reloadIfChanged(): void {
    try {
        const mtime = fs.statSync(ND_CONFIG_PATH).mtimeMs;
        if (mtime === lastMtime) return;
        lastMtime = mtime;
        const ndConfig = JSON.parse(fs.readFileSync(ND_CONFIG_PATH, 'utf-8')) as {
            mcpServices?: AgentMcpConfig;
            pushConfig?:  { selfTileId?: string; selfDashboardId?: string };
        };
        cachedConfig = {
            ...(ndConfig.mcpServices ?? {}),
            ...(ndConfig.pushConfig && { push: ndConfig.pushConfig }),
        };
    } catch { /* file absent or unreadable — keep existing config */ }
}

// Seed lastMtime from the file if it already exists at startup
reloadIfChanged();

setInterval(reloadIfChanged, POLL_INTERVAL_MS);

export function readConfig(): AgentMcpConfig {
    return cachedConfig;
}

export function resolveTileEntry(
    kind: 'rss' | 'todo' | 'notes' | 'list',
    nameOrId?: string,
): TileEntry {
    const cfg = readConfig();
    const group = cfg[kind];
    if (!group) {
        throw new Error(
            `NeonDash-${kind.toUpperCase()} is not configured. ` +
            `Ask the user to open the agent settings and enable the ${kind.toUpperCase()} tiles.`,
        );
    }

    const enabledTiles = group.tiles.filter(t => t.mcpEnabled && t.serviceUrl);

    const groupFolder = process.env['NANOCLAW_GROUP_FOLDER'] ?? '';
    const ownTileId = groupFolder.startsWith('nd_') ? groupFolder.slice(3) : '';

    if (!nameOrId) {
        if (!ownTileId) throw new Error('Tile name or ID required.');
        const own = enabledTiles.find(t => t.id === ownTileId);
        if (own) return own;
        return { id: ownTileId, name: ownTileId, serviceUrl: '', mcpEnabled: true };
    }

    const byId = enabledTiles.find(t => t.id === nameOrId);
    if (byId) return byId;

    const byName = enabledTiles.find(t => t.name.toLowerCase() === nameOrId.toLowerCase());
    if (byName) return byName;

    throw new Error(
        `No ${kind} tile found with name or ID "${nameOrId}". ` +
        `Enabled tiles: ${enabledTiles.map(t => `"${t.name}" (${t.id})`).join(', ')}.`,
    );
}
