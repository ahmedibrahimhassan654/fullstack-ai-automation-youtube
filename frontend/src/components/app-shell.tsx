"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AppSidebar, SIDEBAR_COLLAPSED_KEY } from "@/components/app-sidebar";
import { cn } from "@/lib/utils";

// useLayoutEffect warns when it runs during SSR; the client version is what
// we want so the stored sidebar state is applied before the first paint.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type AppShellProps = {
  title?: string;
  description?: string;
  /** Content rendered on the right of the top bar (buttons, badges...). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes for the scrollable content area. */
  contentClassName?: string;
};

export function AppShell({
  title,
  description,
  actions,
  children,
  contentClassName,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Restore the collapsed state before the first paint.
  useIsomorphicLayoutEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // ignore storage errors (private mode)
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore storage errors (private mode)
    }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock the page scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div
      className="min-h-screen bg-muted/30"
      style={
        {
          "--sidebar-width": collapsed ? "68px" : "260px",
        } as React.CSSProperties
      }
    >
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl">
            <AppSidebar
              collapsed={false}
              variant="drawer"
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="lg:pl-[var(--sidebar-width)]">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <Menu className="size-5" />
            </button>

            <div className="min-w-0 flex-1">
              {title && (
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                  {title}
                </h1>
              )}
              {description && (
                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                  {description}
                </p>
              )}
            </div>

            {actions && (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            )}
          </div>
        </header>

        <main
          className={cn(
            "mx-auto w-full max-w-7xl p-4 sm:p-6",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
