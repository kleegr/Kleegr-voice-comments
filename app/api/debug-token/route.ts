/**
 * GET /api/debug-token?locationId=...  (temporary diagnostic)
 * Reports which env vars are present (booleans only, no secrets) and whether
 * the Supabase Token-table lookup works. Safe to delete once debugging is done.
 */
import { NextResponse } from "next/server";
import { Client } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
    const url = new URL(req.url);
    const locationId = (url.searchParams.get("locationId") || "").trim();

    const env = {
        POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
        DATABASE_URL: !!process.env.DATABASE_URL,
        POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
        POSTGRES_URL: !!process.env.POSTGRES_URL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        GHL_CLIENT_ID: !!process.env.GHL_CLIENT_ID,
        GHL_CLIENT_SECRET: !!process.env.GHL_CLIENT_SECRET,
        GHL_PIT: !!process.env.GHL_PIT,
    };

    const cs = connectionString();
    const result: any = { env, hasConnectionString: !!cs, connectionHost: "" };

    if (cs) {
        try { result.connectionHost = new URL(cs).host; } catch { result.connectionHost = "unparseable"; }
    }

    if (!cs) {
        result.dbError = "No Postgres connection string env var is set";
        return NextResponse.json(result);
    }

    const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        result.connected = true;
        try {
            const t = await client.query('SELECT count(*)::int AS n FROM "Token"');
            result.tokenTableCount = t.rows[0]?.n;
            const a = await client.query('SELECT count(*)::int AS n FROM "Token" WHERE "appId" = $1', [WHATSAPP_APP_ID]);
            result.tokensForWhatsappApp = a.rows[0]?.n;
            if (locationId) {
                const r = await client.query(
                    'SELECT id, ("accessToken" IS NOT NULL) AS has_access, ("refreshToken" IS NOT NULL) AS has_refresh FROM "Token" WHERE "locationId" = $1 AND "appId" = $2 LIMIT 1',
                    [locationId, WHATSAPP_APP_ID]
                );
                result.locationLookup = r.rows[0] || null;
            }
        } catch (qe: any) {
            result.queryError = (qe?.message || String(qe)).slice(0, 300);
        }
    } catch (ce: any) {
        result.connectError = (ce?.message || String(ce)).slice(0, 300);
    } finally {
        await client.end().catch(() => {});
    }

    return NextResponse.json(result);
}
