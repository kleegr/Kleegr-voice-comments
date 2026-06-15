/**
 * POST /api/internal-comment
 *
 * Multi-subaccount: resolves a per-location GHL token from the shared Supabase
 * Token table (falls back to GHL_PIT for the demo). Uploads the audio, posts an
 * InternalComment with the media URL in the text (custom JS renders the player).
 * On an auth failure, refreshes the location token once and retries.
 */

import { NextResponse } from "next/server";
import { uploadAudio, sendInternalComment, getConversationContactId } from "../../../lib/ghl";
import { getLocationTokenRow, refreshLocationToken, TokenRow } from "../../../lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: cors });
}

function isAuthError(e: any): boolean {
    const s = e?.response?.status;
    const body = JSON.stringify(e?.response?.data || "");
    return s === 401 || s === 403 || /not accessible|unauthor/i.test(body);
}

export async function POST(req: Request) {
    try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const contactIdIn = ((form.get("contactId") as string | null) || "").trim();
        const conversationId = ((form.get("conversationId") as string | null) || "").trim();
        const userId = ((form.get("userId") as string | null) || "").trim();
        const note = ((form.get("note") as string | null) || "").trim();
        const locationId = ((form.get("locationId") as string | null) || "").trim();

        if (!file) return NextResponse.json({ success: false, error: "file is required" }, { status: 400, headers: cors });
        if (!contactIdIn && !conversationId)
            return NextResponse.json({ success: false, error: "contactId or conversationId is required" }, { status: 400, headers: cors });

        // Resolve a token: per-location token from Supabase, else the demo PIT.
        let row: TokenRow | null = null;
        let token = "";
        if (locationId) {
            try { row = await getLocationTokenRow(locationId); } catch (e: any) { console.error("[internal-comment] token lookup failed:", e?.message); }
            if (row?.accessToken) token = row.accessToken;
        }
        if (!token && process.env.GHL_PIT) token = process.env.GHL_PIT;
        if (!token) {
            return NextResponse.json(
                { success: false, error: `No GHL token for location ${locationId || "(unknown)"}. Ensure the WhatsApp app is installed there.` },
                { status: 502, headers: cors }
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name || "voice-note.webm";
        const mime = file.type || "audio/webm";

        async function run(accessToken: string) {
            let contactId = contactIdIn;
            if (!contactId && conversationId) {
                contactId = await getConversationContactId(accessToken, conversationId);
                if (!contactId) throw { code: "NO_CONTACT" };
            }
            const mediaUrl = await uploadAudio(accessToken, buffer, filename, mime);
            if (!mediaUrl) throw { code: "UPLOAD_FAILED" };
            const voiceLabel = "\uD83C\uDFA4 Voice note";
            const message = note ? `${note}\n${voiceLabel} ${mediaUrl}` : `${voiceLabel} ${mediaUrl}`;
            const messageId = await sendInternalComment(accessToken, {
                contactId,
                message,
                userId: userId || undefined,
                attachments: [mediaUrl],
            });
            return { mediaUrl, messageId, contactId };
        }

        let out;
        try {
            out = await run(token);
        } catch (e: any) {
            // refresh + retry once, only for a real auth failure on a DB-backed token
            if (row && isAuthError(e)) {
                const fresh = await refreshLocationToken(row);
                if (!fresh) throw e;
                out = await run(fresh);
            } else {
                throw e;
            }
        }

        return NextResponse.json({ success: true, ...out }, { headers: cors });
    } catch (e: any) {
        if (e?.code === "NO_CONTACT")
            return NextResponse.json({ success: false, error: "Could not resolve contact from conversationId" }, { status: 422, headers: cors });
        if (e?.code === "UPLOAD_FAILED")
            return NextResponse.json({ success: false, error: "Audio upload to GHL media library failed" }, { status: 502, headers: cors });
        const detail = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e?.message || "Internal Server Error";
        console.error("[internal-comment] error:", detail);
        return NextResponse.json({ success: false, error: detail }, { status: 502, headers: cors });
    }
}
