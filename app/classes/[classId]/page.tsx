"use client";

import { useParams } from "next/navigation";

export default function ClassHomePage() {
  const params = useParams();
  const classId = params.classId as string;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-gray-900">
        Home
      </h2>

      <p className="mt-2 text-sm text-gray-600">
        Welcome to your class.
      </p>

      <p className="mt-4 text-xs text-gray-400">
        Class ID: {classId}
      </p>
    </div>
  );
}