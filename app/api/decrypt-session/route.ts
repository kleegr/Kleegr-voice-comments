/**
 * POST /api/decrypt-session
 *
 * Decrypts the encrypted session data from GHL's window.exposeSessionDetails().
 * Returns the logged-in user's userId, userName, email, etc.
 * Uses the Shared Secret Key from the App Directory app.
 */

import { NextResponse } from "next/server";
import CryptoJS from "crypto-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const encryptedData = body?.encryptedData;
        if (!encryptedData || typeof encryptedData !== "string") {
            return NextResponse.json({ error: "encryptedData is required" }, { status: 400, headers: cors });
        }

        const sharedSecret = process.env.GHL_SHARED_SECRET;
        if (!sharedSecret) {
            return NextResponse.json({ error: "GHL_SHARED_SECRET is not configured" }, { status: 500, headers: cors });
        }

        const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
            return NextResponse.json({ error: "Decryption failed (empty result)" }, { status: 400, headers: cors });
        }

        const userData = JSON.parse(decrypted);
        return NextResponse.json({
            userId: userData.userId || "",
            userName: userData.userName || "",
            email: userData.email || "",
            role: userData.role || "",
            activeLocation: userData.activeLocation || "",
            companyId: userData.companyId || "",
        }, { headers: cors });
    } catch (e: any) {
        console.error("[decrypt-session] error:", e?.message);
        return NextResponse.json({ error: "Decryption failed: " + (e?.message || "unknown") }, { status: 400, headers: cors });
    }
}
