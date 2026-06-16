/**
 * Per-location GHL token, read from the "Kleegre Apps" Supabase project over the
 * PostgREST (HTTPS) API — robust on Vercel (no DB connection-string / pooler /
 * IPv6 issues). The Token table holds one row per (locationId, appId); we use the
 * App Directory app id (69d29cd45ed1d5be94e6e582), which is installed on every
 * subaccount. Falls back to GHL_PIT only if no Supabase key is configured.
 *
 * Required env (set in the kleegr-voice-comments Vercel project):
 *   - SUPABASE_SERVICE_ROLE_KEY  (Kleegre Apps project → Settings → API → service_role)
 *   - GHL_CLIENT_ID, GHL_CLIENT_SECRET  (App Directory app Client keys, for refresh)
 * Optional:
 *   - SUPABASE_URL (defaults to the Kleegre Apps URL below)
 *   - GHL_APP_ID   (defaults to the App Directory app id)
 */

import axios from "axios";

export const APP_ID = process.env.GHL_APP_ID || "69d29cd45ed1d5be94e6e582";
export const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xpuaxdjfqnoqcnvkgnwx.supabase.co";
const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

function restHeaders() {
    return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

export function hasSupabase(): boolean {
    return !!SERVICE_KEY;
}

export interface TokenRow {
    id: number;
    accessToken: string | null;
    refreshToken: string | null;
}

/** Read the stored per-location token row (or null if the app isn't installed there). */
export async function getLocationTokenRow(locationId: string): Promise<TokenRow | null> {
    if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    const url =
        `${SUPABASE_URL}/rest/v1/Token` +
        `?locationId=eq.${encodeURIComponent(locationId)}` +
        `&appId=eq.${encodeURIComponent(APP_ID)}` +
        `&select=id,accessToken,refreshToken&limit=1`;
    const res = await axios.get(url, { headers: restHeaders() });
    const rows = res.data;
    if (!Array.isArray(rows) || !rows.length) return null;
    return { id: rows[0].id, accessToken: rows[0].accessToken, refreshToken: rows[0].refreshToken };
}

/** Refresh a location token (only call on an auth failure / expiry). Writes the rotated token back. */
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

        // write the rotated token back via PostgREST
        await axios.patch(
            `${SUPABASE_URL}/rest/v1/Token?id=eq.${row.id}`,
            {
                accessToken: at,
                refreshToken: rt || row.refreshToken,
                expiresAt: ein ? new Date(Date.now() + ein * 1000).toISOString() : null,
                updatedAt: new Date().toISOString(),
            },
            { headers: { ...restHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" } }
        );
        return at;
    } catch (e: any) {
        console.error("[token] refresh failed:", e?.response?.data || e?.message);
        return null;
    }
}
