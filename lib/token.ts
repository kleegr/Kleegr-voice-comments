/**
 * Per-location GHL token, read from the SAME Supabase Postgres that the WhatsApp
 * app writes to (the `Token` table, unique on locationId+appId). This lets the
 * voice feature work for every subaccount the WhatsApp app is installed on,
 * with no per-account setup.
 *
 * Refresh policy: we ONLY refresh on an auth failure (see route), then write the
 * rotated token back. GHL rotates refresh tokens, so this row is shared with the
 * WhatsApp app — refreshing rarely keeps the clash window tiny.
 *
 * Required env:
 *   - a Postgres connection string (Supabase integration sets POSTGRES_URL_NON_POOLING / DATABASE_URL)
 *   - GHL_CLIENT_ID, GHL_CLIENT_SECRET   (your WhatsApp marketplace app credentials, for refresh)
 *   - GHL_APP_ID (optional; defaults to the WhatsApp app id)
 */

import axios from "axios";
import { Client } from "pg";

const WHATSAPP_APP_ID = process.env.GHL_APP_ID || "69d29cd45ed1d5be94e6e582";

function connectionString(): string {
    return (
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.DATABASE_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL ||
        ""
    );
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const cs = connectionString();
    if (!cs) throw new Error("No Postgres connection string (set the Supabase integration or DATABASE_URL)");
    const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end().catch(() => {});
    }
}

export interface TokenRow {
    id: number;
    accessToken: string | null;
    refreshToken: string | null;
}

/** Read the stored per-location token row (or null if the app isn't installed there). */
export async function getLocationTokenRow(locationId: string): Promise<TokenRow | null> {
    return withDb(async (c) => {
        const r = await c.query(
            'SELECT id, "accessToken", "refreshToken" FROM "Token" WHERE "locationId" = $1 AND "appId" = $2 LIMIT 1',
            [locationId, WHATSAPP_APP_ID]
        );
        if (!r.rows.length) return null;
        return { id: r.rows[0].id, accessToken: r.rows[0].accessToken, refreshToken: r.rows[0].refreshToken };
    });
}

/** Refresh a location token (only call on an auth failure). Writes the rotated token back. */
export async function refreshLocationToken(row: TokenRow): Promise<string | null> {
    const client_id = process.env.GHL_CLIENT_ID;
    const client_secret = process.env.GHL_CLIENT_SECRET;
    if (!client_id || !client_secret || !row.refreshToken) return null;

    const body = new URLSearchParams();
    body.set("client_id", client_id);
    body.set("client_secret", client_secret);
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", row.refreshToken);

    try {
        const resp = await axios.post("https://services.leadconnectorhq.com/oauth/token", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        const at: string | undefined = resp.data?.access_token;
        const rt: string | undefined = resp.data?.refresh_token;
        const ein: number | undefined = resp.data?.expires_in;
        if (!at) return null;
        await withDb(async (c) => {
            await c.query(
                'UPDATE "Token" SET "accessToken" = $1, "refreshToken" = $2, "expiresAt" = $3, "updatedAt" = now() WHERE id = $4',
                [at, rt || row.refreshToken, ein ? new Date(Date.now() + ein * 1000) : null, row.id]
            );
        });
        return at;
    } catch (e: any) {
        console.error("[token] refresh failed:", e?.response?.data || e?.message);
        return null;
    }
}
