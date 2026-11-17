import CourseDetailClient from "./client";
import { fetchCourse } from "@/lib/server-api";

export const instant = false;

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialCourse = await fetchCourse(id);
  return <CourseDetailClient id={id} initialCourse={initialCourse} />;
}
