import { redirect } from "next/navigation";

export const instant = false;

/**
 * The video list moved to /videos, which is now the "Videos" entry in the
 * sidebar. This route is kept so old bookmarks and links keep working.
 */
export default function DashboardPage() {
  redirect("/videos");
}
