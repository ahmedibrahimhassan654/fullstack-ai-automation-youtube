import CourseDetailClient from "./client";

export const instant = false;

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CourseDetailClient id={id} />;
}
