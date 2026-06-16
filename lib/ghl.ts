/**
 * GHL v2 API helpers. Each takes a bearer token (a per-location access token).
 * These THROW on HTTP error so the caller can detect auth failures and refresh.
 */

import axios from "axios";
import FormData from "form-data";

const BASE = "https://services.leadconnectorhq.com";

export async function uploadAudio(
    token: string,
    data: Buffer,
    filename: string,
    contentType: string
): Promise<string | null> {
    const form = new FormData();
    form.append("file", data, { filename, contentType });
    const res = await axios.post(`${BASE}/medias/upload-file`, form, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", ...form.getHeaders() },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
    });
    return res.data?.file?.url || res.data?.url || res.data?.fileUrl || null;
}

export async function getConversationContactId(token: string, conversationId: string): Promise<string> {
    const res = await axios.get(`${BASE}/conversations/${conversationId}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" },
    });
    return res.data?.contactId || res.data?.conversation?.contactId || "";
}

export async function sendInternalComment(
    token: string,
    p: { contactId: string; message: string; userId?: string; attachments?: string[] }
): Promise<string | undefined> {
    const payload: Record<string, unknown> = {
        type: "InternalComment",
        contactId: p.contactId,
        message: p.message,
        ...(p.userId ? { userId: p.userId } : {}),
        ...(p.attachments && p.attachments.length ? { attachments: p.attachments } : {}),
    };
    const res = await axios.post(`${BASE}/conversations/messages`, payload, {
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Version: "2021-04-15",
            Authorization: `Bearer ${token}`,
        },
    });
    const d = res.data || {};
    return d.messageId || d.id || d.message?.id;
}

export interface GhlUser {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
}

/** Get all users for a location. Uses the deprecated but functional GET /users/ endpoint. */
export async function getLocationUsers(token: string, locationId: string): Promise<GhlUser[]> {
    try {
        const res = await axios.get(`${BASE}/users/`, {
            params: { locationId },
            headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
        });
        const raw = res.data?.users || res.data || [];
        if (!Array.isArray(raw)) return [];
        return raw.map((u: any) => ({
            id: u.id || u._id || "",
            name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || "",
            firstName: u.firstName || "",
            lastName: u.lastName || "",
            email: u.email || "",
        })).filter((u: GhlUser) => u.id);
    } catch (e: any) {
        console.error("[ghl] getLocationUsers failed:", e?.response?.status, e?.response?.data || e?.message);
        return [];
    }
}
