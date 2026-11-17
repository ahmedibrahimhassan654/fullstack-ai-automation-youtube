import VideoDetailClient from "./client";
import { fetchVideo } from "@/lib/server-api";

export const instant = false;

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialVideo = await fetchVideo(id);
  return <VideoDetailClient id={id} initialVideo={initialVideo} />;
}
