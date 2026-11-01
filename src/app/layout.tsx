import type { Metadata } from "next";
import { geistSans, geistMono } from "@/app/fonts";
import "./globals.scss";
import { APP_TEXT } from "@/constants/strings";

export const metadata: Metadata = {
    title: APP_TEXT.title,
    description: APP_TEXT.description,
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
