/**
 * GET /api/audio/[id] — resolve a voice note ID to its audio URL and redirect.
 * The message text contains just "VN-abc123" (not a URL), so the inbox preview
 * stays clean. The player calls this endpoint to get the actual audio.
 */
import { NextResponse } from "next/server";
import axios from "axios";
import { SUPABASE_URL } from "../../../../lib/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    const id = (params.id || "").replace(/\.(webm|ogg|mp3|m4a|wav)$/i, "");
    if (!id || !SERVICE_KEY) return new NextResponse("Not found", { status: 404 });
    try {
        const res = await axios.get(
            `${SUPABASE_URL}/rest/v1/VoiceNote?id=eq.${encodeURIComponent(id)}&select=audioUrl&limit=1`,
            { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
        const url = res.data?.[0]?.audioUrl;
        if (!url) return new NextResponse("Not found", { status: 404 });
        return NextResponse.redirect(url, 302);
    } catch {
        return new NextResponse("Error", { status: 500 });
    }
}
