"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The identity of one course, as returned by GET /api/classes/{classId}. */
export type CourseIdentity = {
  id: string;
  name: string;
  courseCode: string;
  term: string;
  year: number | null;
  section: string;
};

const CourseIdentityContext = createContext<CourseIdentity | null>(null);

/**
 * Holds the course loaded once by the class layout so every page inside
 * /classes/{classId} can name the course it belongs to (PANEL-90) without
 * refetching it. Null while loading or when the course could not be read.
 */
export function CourseIdentityProvider({
  value,
  children,
}: {
  value: CourseIdentity | null;
  children: ReactNode;
}) {
  return (
    <CourseIdentityContext.Provider value={value}>
      {children}
    </CourseIdentityContext.Provider>
  );
}

/** The course the current /classes/{classId} page belongs to, or null. */
export function useCourseIdentity(): CourseIdentity | null {
  return useContext(CourseIdentityContext);
}
