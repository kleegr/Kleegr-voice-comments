/**
 * GET /api/debug-token?locationId=...  (temporary diagnostic)
 * Reports which env vars are present (booleans only) and whether the Kleegre
 * Apps Token lookup works over PostgREST. Safe to delete after debugging.
 */
import { NextResponse } from "next/server";
import axios from "axios";
import { APP_ID, SUPABASE_URL, getLocationTokenRow } from "../../../lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const locationId = (url.searchParams.get("locationId") || "").trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

    const result: any = {
        env: {
            SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
            SUPABASE_URL: !!process.env.SUPABASE_URL,
            GHL_CLIENT_ID: !!process.env.GHL_CLIENT_ID,
            GHL_CLIENT_SECRET: !!process.env.GHL_CLIENT_SECRET,
            GHL_PIT: !!process.env.GHL_PIT,
        },
        supabaseUrl: SUPABASE_URL,
        appId: APP_ID,
    };

    if (!key) {
        result.error = "SUPABASE_SERVICE_ROLE_KEY is not set";
        return NextResponse.json(result);
    }

    try {
        const countRes = await axios.get(
            `${SUPABASE_URL}/rest/v1/Token?appId=eq.${encodeURIComponent(APP_ID)}&select=id`,
            { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" } }
        );
        result.restStatus = countRes.status;
        result.contentRange = countRes.headers["content-range"] || null;
    } catch (e: any) {
        result.restError = (e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e)).slice(0, 300);
        result.restStatus = e?.response?.status;
    }

    if (locationId) {
        try {
            const row = await getLocationTokenRow(locationId);
            result.locationLookup = row ? { id: row.id, hasAccess: !!row.accessToken, hasRefresh: !!row.refreshToken } : null;
        } catch (e: any) {
            result.locationError = (e?.message || String(e)).slice(0, 200);
        }
    }

    return NextResponse.json(result);
}
