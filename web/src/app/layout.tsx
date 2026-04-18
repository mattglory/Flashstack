import type { Metadata } from "next";
import "./globals.css";
import { StacksProvider } from "@/lib/providers/StacksProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";

export const metadata: Metadata = {
  title: "FlashStack - Flash Loans on Bitcoin",
  description: "The first flash loan protocol for Bitcoin Layer 2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface text-slate-100 antialiased">
        <StacksProvider>
          <div className="flex min-h-screen">
            {/* Desktop sidebar — hidden on mobile */}
            <Sidebar />
            {/* Main content — full width on mobile, offset on desktop */}
            <div className="flex-1 flex flex-col md:ml-64">
              <Header />
              <main className="flex-1 p-4 md:p-6">{children}</main>
            </div>
          </div>
          {/* Mobile bottom navigation */}
          <MobileNav />
        </StacksProvider>
      </body>
    </html>
  );
}
