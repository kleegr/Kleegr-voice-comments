/**
 * GET /api/resolve-user?locationId=xxx&email=yyy
 *
 * Returns the GHL userId for the logged-in user so the script can pass it when
 * posting internal comments (makes the comment show the user's real initials).
 * Fetches users from GHL Users API and matches by email.
 * Also returns all users so the script can match by other means if needed.
 */

import { NextResponse } from "next/server";
import { getLocationUsers, GhlUser } from "../../../lib/ghl";
import { getLocationTokenRow, refreshLocationToken, hasSupabase } from "../../../lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: cors });
}

function isAuthError(e: any): boolean {
    const s = e?.response?.status;
    const body = JSON.stringify(e?.response?.data || "");
    return s === 401 || s === 403 || /not accessible|unauthor/i.test(body);
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const locationId = (url.searchParams.get("locationId") || "").trim();
    const email = (url.searchParams.get("email") || "").trim().toLowerCase();

    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400, headers: cors });

    // get token
    let token = "";
    let row = null as any;
    if (hasSupabase()) {
        try { row = await getLocationTokenRow(locationId); } catch (e) {}
        if (row?.accessToken) token = row.accessToken;
    }
    if (!token && process.env.GHL_PIT) token = process.env.GHL_PIT;
    if (!token) return NextResponse.json({ error: "No token for location" }, { status: 502, headers: cors });

    // fetch users (with refresh-on-failure)
    let users: GhlUser[] = [];
    try {
        users = await getLocationUsers(token, locationId);
    } catch (e: any) {
        if (row && isAuthError(e)) {
            const fresh = await refreshLocationToken(row);
            if (fresh) users = await getLocationUsers(fresh, locationId);
        }
    }

    // match by email
    let matched: GhlUser | null = null;
    if (email && users.length) {
        matched = users.find(u => u.email.toLowerCase() === email) || null;
    }

    return NextResponse.json({
        matched: matched ? { id: matched.id, name: matched.name, email: matched.email } : null,
        users: users.map(u => ({ id: u.id, name: u.name, email: u.email })),
    }, { headers: cors });
}
