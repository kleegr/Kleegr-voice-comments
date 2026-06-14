export default function Home() {
    return (
        <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px", lineHeight: 1.6 }}>
            <h1 style={{ fontSize: 24 }}>Kleegr Voice Comments</h1>
            <p style={{ color: "#555" }}>
                Backend for the GHL internal-comment voice-note button. This service is healthy if you can read this.
            </p>
            <p style={{ color: "#555" }}>
                The mic lives inside GoHighLevel via custom JS; it posts recordings here, which uploads the audio and
                writes an <strong>InternalComment</strong> to the contact&apos;s conversation.
            </p>
            <p style={{ fontSize: 13, color: "#999" }}>Endpoint: <code>POST /api/internal-comment</code></p>
        </main>
    );
}
