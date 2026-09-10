import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { ClinicProvider } from "@/components/clinic-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pet Care Clinic",
  description: "Pet care clinic management",
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
