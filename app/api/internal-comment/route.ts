/**
 * POST /api/internal-comment
 * Pads with em-spaces between label and ID so preview truncates before the ID.
 */
import { NextResponse } from "next/server";
import axios from "axios";
import { uploadAudio, sendInternalComment, getConversationContactId } from "../../../lib/ghl";
import { getLocationTokenRow, refreshLocationToken, TokenRow, hasSupabase, SUPABASE_URL } from "../../../lib/token";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept" };
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

function isAuthError(e: any): boolean {
    const s = e?.response?.status; const body = JSON.stringify(e?.response?.data || "");
    return s === 401 || s === 403 || /not accessible|unauthor/i.test(body);
}

function genShortId(): string { return crypto.randomBytes(4).toString("hex"); }

async function storeVoiceNote(id: string, audioUrl: string, locationId: string): Promise<void> {
    if (!SERVICE_KEY) return;
    await axios.post(`${SUPABASE_URL}/rest/v1/VoiceNote`, { id, audioUrl, locationId },
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" } });
}

// 80 em-spaces (U+2003) to push the ID past any preview truncation
const EM_PAD = "\u2003".repeat(80);

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
        if (!contactIdIn && !conversationId) return NextResponse.json({ success: false, error: "contactId or conversationId is required" }, { status: 400, headers: cors });
        let row: TokenRow | null = null; let token = "";
        if (locationId && hasSupabase()) { try { row = await getLocationTokenRow(locationId); } catch (e: any) {} if (row?.accessToken) token = row.accessToken; }
        if (!token && process.env.GHL_PIT) token = process.env.GHL_PIT;
        if (!token) return NextResponse.json({ success: false, error: "No token" }, { status: 502, headers: cors });
        const buffer = Buffer.from(await file.arrayBuffer()); const filename = file.name || "voice-note.webm"; const mime = file.type || "audio/webm";

        async function postComment(accessToken: string, contactId: string, mediaUrl: string) {
            const vnId = genShortId();
            try { await storeVoiceNote(vnId, mediaUrl, locationId); } catch (e: any) { console.error("[internal-comment] storeVoiceNote:", e?.message); }
            const voiceLabel = "\uD83C\uDFA4 Voice note";
            // Label + 80 em-spaces + vn:ID. Preview truncates in the spaces, showing only the label.
            const message = note
                ? `${note}\n${voiceLabel}${EM_PAD}vn:${vnId}`
                : `${voiceLabel}${EM_PAD}vn:${vnId}`;
            try { return await sendInternalComment(accessToken, { contactId, message, userId: userId || undefined, attachments: [mediaUrl] }); }
            catch (e: any) { if (userId && !isAuthError(e)) { return await sendInternalComment(accessToken, { contactId, message, attachments: [mediaUrl] }); } throw e; }
        }

        async function run(accessToken: string) {
            let contactId = contactIdIn;
            if (!contactId && conversationId) { contactId = await getConversationContactId(accessToken, conversationId); if (!contactId) throw { code: "NO_CONTACT" }; }
            const mediaUrl = await uploadAudio(accessToken, buffer, filename, mime); if (!mediaUrl) throw { code: "UPLOAD_FAILED" };
            const messageId = await postComment(accessToken, contactId, mediaUrl); return { mediaUrl, messageId, contactId };
        }
        let out;
        try { out = await run(token); } catch (e: any) { if (row && isAuthError(e)) { const fresh = await refreshLocationToken(row); if (!fresh) throw e; out = await run(fresh); } else { throw e; } }
        return NextResponse.json({ success: true, ...out }, { headers: cors });
    } catch (e: any) {
        if (e?.code === "NO_CONTACT") return NextResponse.json({ success: false, error: "Could not resolve contact" }, { status: 422, headers: cors });
        if (e?.code === "UPLOAD_FAILED") return NextResponse.json({ success: false, error: "Audio upload failed" }, { status: 502, headers: cors });
        const detail = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e?.message || "Error";
        return NextResponse.json({ success: false, error: detail }, { status: 502, headers: cors });
    }
}
