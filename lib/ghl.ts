/**
 * Minimal GHL v2 API helpers — standalone (no shared imports).
 *
 * Mirrors the proven calls from kleegr/Whatsapp lib/ghl.ts:
 *   - uploadAudio          → POST /medias/upload-file   (returns hosted URL)
 *   - getConversationContactId → GET /conversations/:id  (resolve contactId)
 *   - sendInternalComment  → POST /conversations/messages (type=InternalComment)
 *
 * Auth: a single Private Integration Token (PIT) in env GHL_PIT. The PIT is
 * scoped to the pilot subaccount, so no locationId juggling is needed.
 */

import axios from "axios";
import FormData from "form-data";

const BASE = "https://services.leadconnectorhq.com";

/** Upload an audio buffer to the GHL media library; returns the hosted URL. */
export async function uploadAudio(
    token: string,
    data: Buffer,
    filename: string,
    contentType: string
): Promise<string | null> {
    const form = new FormData();
    form.append("file", data, { filename, contentType });
    try {
        const res = await axios.post(`${BASE}/medias/upload-file`, form, {
            headers: {
                Authorization: `Bearer ${token}`,
                Version: "2021-07-28",
                ...form.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
        return (
            res.data?.file?.url ||
            res.data?.url ||
            res.data?.fileUrl ||
            null
        );
    } catch (e: any) {
        console.error("[ghl] uploadAudio failed:", e.response?.data || e.message);
        return null;
    }
}

/** Resolve a conversation's contactId (so the browser only needs conversationId). */
export async function getConversationContactId(
    token: string,
    conversationId: string
): Promise<string> {
    try {
        const res = await axios.get(`${BASE}/conversations/${conversationId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Version: "2021-04-15",
                Accept: "application/json",
            },
        });
        return (
            res.data?.contactId ||
            res.data?.conversation?.contactId ||
            ""
        );
    } catch (e: any) {
        console.error("[ghl] getConversationContactId failed:", e.response?.data || e.message);
        return "";
    }
}

export interface InternalCommentResult {
    ok: boolean;
    messageId?: string;
    error?: string;
}

/** Post an InternalComment to a contact's conversation, with optional attachments. */
export async function sendInternalComment(
    token: string,
    p: { contactId: string; message: string; userId?: string; attachments?: string[] }
): Promise<InternalCommentResult> {
    const payload: Record<string, unknown> = {
        type: "InternalComment",
        contactId: p.contactId,
        message: p.message,
        ...(p.userId ? { userId: p.userId } : {}),
        ...(p.attachments && p.attachments.length ? { attachments: p.attachments } : {}),
    };
    try {
        const res = await axios.post(`${BASE}/conversations/messages`, payload, {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Version: "2021-04-15",
                Authorization: `Bearer ${token}`,
            },
        });
        const d = res.data || {};
        return { ok: true, messageId: d.messageId || d.id || d.message?.id };
    } catch (e: any) {
        return { ok: false, error: JSON.stringify(e.response?.data || e.message) };
    }
}
