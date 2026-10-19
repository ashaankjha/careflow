import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CareFlow AI", template: "%s · CareFlow AI" },
  description: "Capacity-aware growth OS for ABA providers — synthetic demonstration",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" toastOptions={{ className: "!text-[13px] !rounded-lg !border-line" }} />
      </body>
    </html>
  );
}
