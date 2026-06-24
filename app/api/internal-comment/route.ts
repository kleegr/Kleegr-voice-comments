/**
 * POST /api/internal-comment
 * Voice notes: URL in text only, NO attachments (our player finds the <a> tag).
 * File attachments: NO URL in text, WITH attachments array (GHL renders natively).
 */
import { NextResponse } from "next/server";
import { uploadAudio, sendInternalComment, getConversationContactId } from "../../../lib/ghl";
import { getLocationTokenRow, refreshLocationToken, TokenRow, hasSupabase } from "../../../lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept" };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

function isAuthError(e: any): boolean {
    const s = e?.response?.status; const body = JSON.stringify(e?.response?.data || "");
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
        const origFileName = ((form.get("fileName") as string | null) || "").trim();
        if (!file) return NextResponse.json({ success: false, error: "file is required" }, { status: 400, headers: cors });
        if (!contactIdIn && !conversationId) return NextResponse.json({ success: false, error: "contactId or conversationId is required" }, { status: 400, headers: cors });
        let row: TokenRow | null = null; let token = "";
        if (locationId && hasSupabase()) { try { row = await getLocationTokenRow(locationId); } catch (e: any) {} if (row?.accessToken) token = row.accessToken; }
        if (!token && process.env.GHL_PIT) token = process.env.GHL_PIT;
        if (!token) return NextResponse.json({ success: false, error: "No token" }, { status: 502, headers: cors });
        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = origFileName || file.name || "voice-note.webm";
        const mime = file.type || "application/octet-stream";
        const isVoice = !origFileName;

        async function postComment(accessToken: string, contactId: string, mediaUrl: string) {
            let message: string;
            let attachments: string[] | undefined;

            if (isVoice) {
                // VOICE: URL in text (player needs the <a> tag), NO attachments (prevents GHL native player)
                const voiceLabel = "\uD83C\uDFA4 Voice note";
                message = note ? `${note}\n${voiceLabel} ${mediaUrl}` : `${voiceLabel} ${mediaUrl}`;
                attachments = undefined;
            } else {
                // FILE: NO URL in text (clean bubble), WITH attachments (GHL renders native preview)
                const fileLabel = "\uD83D\uDCCE " + filename;
                message = note ? `${note}\n${fileLabel}` : fileLabel;
                attachments = [mediaUrl];
            }

            try { return await sendInternalComment(accessToken, { contactId, message, userId: userId || undefined, attachments }); }
            catch (e: any) { if (userId && !isAuthError(e)) { return await sendInternalComment(accessToken, { contactId, message, attachments }); } throw e; }
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
        if (e?.code === "UPLOAD_FAILED") return NextResponse.json({ success: false, error: "File upload failed" }, { status: 502, headers: cors });
        const detail = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e?.message || "Error";
        return NextResponse.json({ success: false, error: detail }, { status: 502, headers: cors });
    }
}
