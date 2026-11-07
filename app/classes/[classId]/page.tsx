"use client";

import { useParams } from "next/navigation";
import CourseMaterials from "../../components/classes/CourseMaterials";
import { useCourseIdentity } from "../../components/classes/CourseIdentity";

export default function ClassHomePage() {
  const params = useParams();
  const classId = params.classId as string;
  const course = useCourseIdentity();

  // PANEL-90: name the course instead of the generic "your class".
  const courseLabel =
    course && (course.courseCode || course.name)
      ? [course.courseCode, course.name].filter(Boolean).join(" ")
      : "your class";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
        Home
      </h2>

      <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
        Welcome to {courseLabel}.
      </p>

      <CourseMaterials classId={classId} />
    </div>
  );
}
