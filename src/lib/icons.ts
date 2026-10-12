// Icons lucide doesn't have, drawn on its 24px grid so they sit with the rest.
import { createLucideIcon } from "lucide-react";

/** Rotate right: a frame with an arrow turning over its top right (a quarter turn). */
export const RotateRight = createLucideIcon("rotate-right", [
  ["rect", { x: "3", y: "10", width: "11", height: "11", rx: "2", key: "frame" }],
  ["path", { d: "M9 5h4a6 6 0 0 1 6 6v3", key: "arc" }],
  ["path", { d: "m16 11 3 3 3-3", key: "head" }],
]);

/** Rotate left: the mirror of RotateRight. */
export const RotateLeft = createLucideIcon("rotate-left", [
  ["rect", { x: "10", y: "10", width: "11", height: "11", rx: "2", key: "frame" }],
  ["path", { d: "M15 5h-4a6 6 0 0 0-6 6v3", key: "arc" }],
  ["path", { d: "m8 11-3 3-3-3", key: "head" }],
]);
