"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Film,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/toast-provider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const SIDEBAR_COLLAPSED_KEY = "aiv-sidebar-collapsed";

export type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** Closes the drawer after a navigation (mobile only). */
  onNavigate?: () => void;
  /** Renders the close button instead of the collapse toggle (mobile drawer). */
  variant?: "fixed" | "drawer";
};

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Decides whether the item is the active one for the current path. */
  isActive: (pathname: string) => boolean;
  adminOnly?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        title: "Videos",
        href: "/videos",
        icon: Film,
        // The list of videos stays selected while a single video is open.
        // The upload page has its own entry.
        isActive: (pathname) =>
          pathname === "/videos" ||
          (pathname.startsWith("/videos/") && pathname !== "/videos/new"),
      },
      {
        title: "Upload Video",
        href: "/videos/new",
        icon: UploadCloud,
        isActive: (pathname) => pathname === "/videos/new",
      },
      {
        title: "Create Course",
        href: "/courses/new",
        icon: BookOpen,
        isActive: (pathname) =>
          pathname === "/courses/new" || pathname.startsWith("/courses/"),
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        isActive: (pathname) => pathname === "/settings",
      },
      {
        title: "Admin",
        href: "/admin",
        icon: ShieldCheck,
        isActive: (pathname) => pathname === "/admin",
        adminOnly: true,
      },
    ],
  },
];

const initialsOf = (name?: string | null) =>
  (name || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  variant = "fixed",
}: SidebarProps) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const toast = useToast();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully.");
      router.push("/login");
    } catch {
      toast.error("Logout failed. Please try again.");
    }
  };

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        variant === "fixed" ? "w-[var(--sidebar-width)]" : "w-[280px]",
        "transition-[width] duration-200 ease-out",
      )}
    >
      {/* Brand + toggle */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-3",
          collapsed ? "justify-center px-2" : "justify-between",
        )}
      >
        <Link
          href="/videos"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            collapsed && "justify-center",
          )}
          aria-label="AI YouTube Automation home"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-sm">
            <Sparkles className="size-4.5" />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight">
                AI YouTube
              </span>
              <span className="block truncate text-[11px] leading-tight text-sidebar-foreground/60">
                Automation Hub
              </span>
            </span>
          )}
        </Link>

        {variant === "drawer" ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close menu"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "hidden size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex",
              collapsed && "absolute right-[-13px] top-4 z-20 size-7 border border-sidebar-border bg-sidebar shadow-sm",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronsLeft className="size-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(
            (item) => !item.adminOnly || user?.role === "admin",
          );
          if (items.length === 0) return null;

          return (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                  {section.title}
                </p>
              )}
              {collapsed && (
                <div className="mx-2 mb-2 h-px bg-sidebar-border" aria-hidden />
              )}

              {items.map((item) => {
                const active = item.isActive(pathname);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.title : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {/* Active indicator */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon
                      className={cn(
                        "size-4.5 shrink-0 transition-colors",
                        active
                          ? "text-sidebar-primary"
                          : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.title}</span>}

                    {/* Tooltip for the collapsed state */}
                    {collapsed && (
                      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100 lg:block">
                        {item.title}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Account */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
              title={user?.name || "Account"}
            >
              {initialsOf(user?.name)}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              className="flex size-8 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-destructive"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {initialsOf(user?.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">
                  {user?.name || "Account"}
                </p>
                <p className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
                  {user?.email}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary" className="capitalize">
                {user?.subscription?.plan || "free"}
              </Badge>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-destructive"
              >
                <LogOut className="size-3.5" />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
