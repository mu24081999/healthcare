import { Shell } from "@/components/shell";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Shell>{children}</Shell>;
}
