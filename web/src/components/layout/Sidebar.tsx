"use client";

import Image from "next/image";
import Link from "next/link";

const navItems = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Flash Loan", href: "#", comingSoon: true },
  { label: "Receivers", href: "#", comingSoon: true },
  { label: "Admin", href: "#", comingSoon: true },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-surface-card border-r border-surface-border flex flex-col">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <Image
          src="/flashstack-logo.svg"
          alt="FlashStack"
          width={36}
          height={36}
        />
        <span className="text-lg font-bold text-white">FlashStack</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 mt-2">
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`flex items-center justify-between px-4 py-3 rounded-lg mb-1 text-sm transition-colors ${
              item.active
                ? "bg-brand-600/10 text-brand-400 font-medium"
                : "text-slate-400 hover:text-slate-200 hover:bg-surface-hover"
            } ${item.comingSoon ? "cursor-default" : ""}`}
            onClick={item.comingSoon ? (e) => e.preventDefault() : undefined}
          >
            <span>{item.label}</span>
            {item.comingSoon && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-hover text-slate-500">
                Soon
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-surface-border">
        <a
          href="https://github.com/mattglory/flashstack"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          GitHub
        </a>
      </div>
    </aside>
  );
}
