"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Settings,
  Plus,
  FolderKanban,
  Terminal,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "chat", icon: MessageSquare },
  { href: "/projects", label: "projects", icon: FolderKanban },
  { href: "/sessions", label: "sessions", icon: Terminal },
  { href: "/settings", label: "config", icon: Settings },
];

interface TopNavProps {
  onNewChat: () => void;
}

export function TopNav({ onNewChat }: TopNavProps) {
  const pathname = usePathname();
  const isOnChat =
    pathname === "/chat" || pathname.startsWith("/chat/");

  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("jarvis-theme");
    if (saved === "light") {
      setTheme("light");
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("jarvis-theme", next);
    if (next === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  return (
    <nav className="flex h-11 shrink-0 items-center border-b border-border bg-surface px-5">
      {/* Brand */}
      <Link href="/chat" className="flex items-center gap-2.5 mr-6">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
          <span className="text-[11px] font-bold text-accent-foreground">J</span>
        </div>
        <span className="text-[15px] font-bold tracking-wide text-foreground">
          Jarvis
        </span>
      </Link>

      {/* Tabs */}
      <div className="flex items-center gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/chat" && pathname.startsWith("/chat/")) ||
            (item.href === "/projects" && pathname.startsWith("/projects")) ||
            (item.href === "/sessions" && pathname.startsWith("/sessions")) ||
            (item.href === "/settings" && pathname.startsWith("/settings"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status */}
      <div className="flex items-center gap-2 mr-4">
        <span className="h-1.5 w-1.5 rounded-full bg-green status-dot-live" />
        <span className="text-[12px] text-muted-foreground">Online</span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-hover mr-2"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>

      {/* New Chat */}
      {isOnChat && (
        <button
          onClick={onNewChat}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent-dim"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      )}
    </nav>
  );
}
