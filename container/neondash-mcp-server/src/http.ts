export async function ndGet(baseUrl: string, tileId: string, authHeaders?: Record<string, string>): Promise<unknown> {
    const url = `${baseUrl}/api/${encodeURIComponent(tileId)}`;
    const res = await fetch(url, { headers: { ...authHeaders } });
    if (!res.ok) throw new Error(`HTTP ${res.status} GET ${url}`);
    return res.json();
}

export async function ndCmd(
    baseUrl: string,
    tileId: string,
    payload: object,
    authHeaders?: Record<string, string>,
): Promise<unknown> {
    const url = `${baseUrl}/api/${encodeURIComponent(tileId)}/cmd`;
    const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify({ tileId, ...payload }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} POST ${url}`);
    return res.json();
}

export function pick<T extends object>(items: T[], keys: (keyof T)[]): Partial<T>[] {
    return items.map(item => {
        const out: Partial<T> = {};
        for (const key of keys) {
            if (key in item) out[key] = item[key];
        }
        return out;
    });
}

export async function ndSearch<T>(
    baseUrl: string,
    tileId: string,
    query: string,
    authHeaders?: Record<string, string>,
): Promise<T[]> {
    const res = await ndCmd(baseUrl, tileId, { action: 'search', query }, authHeaders) as { items?: T[] };
    return res.items ?? [];
}
