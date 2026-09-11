import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { ClinicProvider } from "@/components/clinic-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Health-Care",
  description: "Health-Care clinic management",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    shortcut: "/favicon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ClinicProvider>{children}</ClinicProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
