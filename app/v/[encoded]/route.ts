/**
 * GET /v/[encoded] — redirect to the full audio URL.
 * Keeps inbox preview clean by using short URLs in the message text.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { encoded: string } }) {
    try {
        const encoded = params.encoded || "";
        const clean = encoded.replace(/\.(webm|ogg|mp3|m4a|wav)$/i, "");
        const decoded = Buffer.from(clean, "base64url").toString("utf-8");
        if (!decoded || !decoded.startsWith("http")) {
            return NextResponse.json({ error: "invalid" }, { status: 400 });
        }
        return NextResponse.redirect(decoded, 302);
    } catch {
        return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
}
