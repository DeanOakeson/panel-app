import { describe, expect, it } from "vitest";
import {
  getHomePath,
  HOME_PATHS,
  NO_ROLE_PATH,
  PENDING_APPROVAL_PATH,
} from "@/lib/homePath";

describe("getHomePath", () => {
  it("sends admins to the admin home view", () => {
    expect(getHomePath({ role: "admin" })).toBe(HOME_PATHS.admin);
  });

  it.each([undefined, "approved"])(
    "sends professors (professorStatus %j) to the professor home view",
    (professorStatus) => {
      expect(getHomePath({ role: "professor", professorStatus })).toBe(
        HOME_PATHS.professor
      );
    }
  );

  it.each([undefined, "not_requested", "rejected"])(
    "sends students (professorStatus %j) to the student course dashboard",
    (professorStatus) => {
      expect(getHomePath({ role: "student", professorStatus })).toBe(
        HOME_PATHS.student
      );
    }
  );

  it("holds back students whose professor application is pending", () => {
    expect(getHomePath({ role: "student", professorStatus: "pending" })).toBe(
      PENDING_APPROVAL_PATH
    );
  });

  it("sends users with no profile to the contact-admin page", () => {
    expect(getHomePath(null)).toBe(NO_ROLE_PATH);
  });

  it.each([
    ["no role", {}],
    ["an unknown role", { role: "teacher" }],
    ["a role in the wrong case", { role: "Admin" }],
    ["a non-string role", { role: 1 }],
  ])("sends a profile with %s to the contact-admin page", (_, profile) => {
    expect(getHomePath(profile)).toBe(NO_ROLE_PATH);
  });
});
