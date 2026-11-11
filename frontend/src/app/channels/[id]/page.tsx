import ChannelDetailClient from "./client";

export const instant = false;

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChannelDetailClient id={id} />;
}
