/**
 * GET /v/[encoded] — redirect to the full audio URL.
 * The message text contains a short URL like /v/xxx.webm which this route
 * decodes and redirects to the real CDN URL. Keeps the inbox preview clean.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { encoded: string } }) {
    try {
        const encoded = params.encoded || "";
        // strip .webm/.ogg etc extension we appended for the player matcher
        const clean = encoded.replace(/\.(webm|ogg|mp3|m4a|wav)$/i, "");
        // decode base64url → original URL
        const decoded = Buffer.from(clean, "base64url").toString("utf-8");
        if (!decoded || !decoded.startsWith("http")) {
            return NextResponse.json({ error: "invalid" }, { status: 400 });
        }
        return NextResponse.redirect(decoded, 302);
    } catch {
        return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
}
