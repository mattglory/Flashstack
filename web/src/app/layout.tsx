import type { Metadata } from "next";
import "./globals.css";
import { StacksProvider } from "@/lib/providers/StacksProvider";

export const metadata: Metadata = {
  title: "FlashStack — Flash Loans on Bitcoin",
  description: "Open flash-loan infrastructure on Stacks. Borrow STX or canonical sBTC with zero collateral and repay in the same transaction.",
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
          {children}
        </StacksProvider>
      </body>
    </html>
  );
}
