import VideoDetailClient from "./client";

export const instant = false;

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VideoDetailClient id={id} />;
}
