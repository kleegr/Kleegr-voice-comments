/**
 * POST /api/internal-comment
 *
 * Uploads the recorded voice note to GHL media and posts it as an
 * InternalComment. Optional typed text (note) is included above the voice note.
 * The media URL is included in the message text so the custom JS can render an
 * inline player (GHL does not render attachments as players on internal comments).
 *
 * Auth: server-side PIT in env GHL_PIT. The browser never sees the token.
 */

import { NextResponse } from "next/server";
import { uploadAudio, sendInternalComment, getConversationContactId } from "../../../lib/ghl";

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

export async function POST(req: Request) {
    try {
        const token = process.env.GHL_PIT;
        if (!token) {
            return NextResponse.json(
                { success: false, error: "Server not configured: GHL_PIT env var is missing" },
                { status: 500, headers: cors }
            );
        }

        const form = await req.formData();
        const file = form.get("file") as File | null;
        let contactId = ((form.get("contactId") as string | null) || "").trim();
        const conversationId = ((form.get("conversationId") as string | null) || "").trim();
        const userId = ((form.get("userId") as string | null) || "").trim();
        const note = ((form.get("note") as string | null) || "").trim();

        if (!file) {
            return NextResponse.json({ success: false, error: "file is required" }, { status: 400, headers: cors });
        }
        if (!contactId && !conversationId) {
            return NextResponse.json(
                { success: false, error: "contactId or conversationId is required" },
                { status: 400, headers: cors }
            );
        }

        if (!contactId && conversationId) {
            contactId = await getConversationContactId(token, conversationId);
            if (!contactId) {
                return NextResponse.json(
                    { success: false, error: "Could not resolve contact from conversationId" },
                    { status: 422, headers: cors }
                );
            }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name || "voice-note.webm";
        const mime = file.type || "audio/webm";

        const mediaUrl = await uploadAudio(token, buffer, filename, mime);
        if (!mediaUrl) {
            return NextResponse.json(
                { success: false, error: "Audio upload to GHL media library failed" },
                { status: 502, headers: cors }
            );
        }

        // Typed text (if any) goes first, then the voice-note label + URL (the
        // custom JS turns the URL into an inline player).
        const voiceLabel = "\uD83C\uDFA4 Voice note";
        const message = note ? `${note}\n${voiceLabel} ${mediaUrl}` : `${voiceLabel} ${mediaUrl}`;
        const result = await sendInternalComment(token, {
            contactId,
            message,
            userId: userId || undefined,
            attachments: [mediaUrl],
        });

        if (!result.ok) {
            return NextResponse.json(
                { success: false, error: result.error || "Failed to post internal comment", mediaUrl },
                { status: 502, headers: cors }
            );
        }

        return NextResponse.json(
            { success: true, mediaUrl, messageId: result.messageId, contactId },
            { headers: cors }
        );
    } catch (e: any) {
        console.error("[internal-comment] error:", e?.message ?? e);
        return NextResponse.json(
            { success: false, error: e?.message ?? "Internal Server Error" },
            { status: 500, headers: cors }
        );
    }
}
