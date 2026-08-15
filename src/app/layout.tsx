import type { Metadata } from "next";
import { geistSans, geistMono } from "@/app/fonts";
import "./globals.scss";

export const metadata: Metadata = {
    title: "Ashvale",
    description:
        "Explore any GitHub repository as a procedurally generated realm — its structure becomes terrain, its history becomes enemies.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
            <body>{children}</body>
        </html>
    );
}
