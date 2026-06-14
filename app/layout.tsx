export const metadata = {
    title: "Kleegr Voice Comments",
    description: "Voice notes for GHL internal comments",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
        </html>
    );
}
