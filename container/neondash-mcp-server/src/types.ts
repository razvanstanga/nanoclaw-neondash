export interface TileEntry {
    id: string;
    name: string;
    serviceUrl: string;
    authHeaders?: Record<string, string>;
    mcpEnabled: boolean;
}

export interface ServiceGroup {
    tiles: TileEntry[];
}

export interface AgentPushConfig {
    selfTileId?:      string;
    selfDashboardId?: string;
}

export interface AgentMcpConfig {
    rss?:   ServiceGroup;
    todo?:  ServiceGroup;
    notes?: ServiceGroup;
    list?:  ServiceGroup;
    push?:  AgentPushConfig;
}

export interface InteractionEntry {
    action:    'read' | 'star' | 'unstar';
    tileId:    string;
    title:     string;
    feedLabel: string;
    link?:     string;
    ts:        number;
}

export interface RecContextUnreadItem {
    feed:  string;
    title: string;
    date:  string;
    desc:  string;
    link:  string;
}

export interface RecContextResponse {
    interactions: Omit<InteractionEntry, 'tileId'>[];
    unread:       RecContextUnreadItem[];
    stats:        { totalInteractions: number; totalUnread: number };
    generatedAt:  string;
}

// ── RSS ──────────────────────────────────────────────────────────────────────

export interface RssItem {
    id: string;
    title?: string;
    description?: string;
    link?: string;
    pubDate?: string;
    feedLabel?: string;
    feedId?: string;
    read?: boolean;
    starred?: boolean;
}

export interface RssFeed {
    id: string;
    url: string;
    label?: string;
    title?: string;
    active: boolean;
    pushEnabled?: boolean;
}

export interface RssConfig {
    pushEnabled?: boolean;
    dashboardId?: string;
    cooldown?: number;
    itemsPerPage?: number;
    sound?: string;
}

export interface RssResponse {
    tileId?: string;
    items?: RssItem[];
    feeds?: RssFeed[];
    config?: RssConfig;
}

// ── ToDo ─────────────────────────────────────────────────────────────────────

export interface TodoReminder {
    id: string;
    amount: number;
    unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
    pushMessageId?: string;
    scheduledAt?: number;
}

export interface RecurrenceRule {
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endDate?: string;
    maxOccurrences?: number;
    completions?: number;
}

export interface TodoItem {
    id: string;
    title: string;
    description?: string;
    tags?: string[];
    date?: string;
    done: boolean;
    important?: boolean;
    color?: string;
    reminders?: TodoReminder[];
    recurrence?: RecurrenceRule;
}

export interface TodoResponse {
    tileId?: string;
    items?: TodoItem[];
}

// ── Notes ────────────────────────────────────────────────────────────────────

export interface NoteItem {
    id: string;
    title?: string;
    body?: string;
    tags?: string[];
    color?: string;
    important?: boolean;
    createdAt?: number;
    updatedAt?: number;
}

export interface NotesConfig {
    transcribeEnabled?: boolean;
    transcribeMaxSeconds?: number;
    wisperUrl?: string;
    wisperToken?: string;
}

export interface NotesResponse {
    tileId?: string;
    items?: NoteItem[];
    config?: NotesConfig;
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface ListItem {
    id: string;
    title: string;
    description?: string;
    label?: string;
    tags?: string[];
    date?: string;
    expiry?: string;
    read?: boolean;
    starred?: boolean;
    color?: string;
}

export interface ListConfig {
    selectedTags?: string[];
    selectedLabels?: string[];
    pageSize?: number;
}

export interface ListResponse {
    tileId?: string;
    items?: ListItem[];
    availableTags?: string[];
    availableLabels?: string[];
    config?: ListConfig;
}
