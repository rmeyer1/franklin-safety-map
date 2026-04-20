import type { Incident } from "@/lib/types/domain";

const now = new Date().toISOString();

export const mockIncidents: Incident[] = [
  {
    id: "inc-1",
    layer: "police",
    category: "Suspicious Activity",
    address: "N High St & E Long St",
    description: "Caller reports a person checking car doors near the corner.",
    severity: 2,
    severityLabel: "low",
    status: "Active",
    createdAt: now,
    updatedAt: now,
    point: { lat: 39.9643, lng: -82.9988 },
  },
  {
    id: "inc-2",
    layer: "fire",
    category: "Medical Emergency",
    address: "W Broad St & N Front St",
    description: "EMS response dispatched for an unconscious person.",
    severity: 3,
    severityLabel: "medium",
    status: "Active",
    createdAt: now,
    updatedAt: now,
    point: { lat: 39.9622, lng: -83.0011 },
  },
  {
    id: "inc-3",
    layer: "traffic",
    category: "Crash",
    address: "I-670 E near Cleveland Ave",
    description: "Two-vehicle collision affecting the right lane.",
    severity: 4,
    severityLabel: "high",
    status: "Active",
    createdAt: now,
    updatedAt: now,
    point: { lat: 39.9814, lng: -82.9822 },
  },
  {
    id: "inc-4",
    layer: "police",
    category: "Shots Fired",
    address: "E Livingston Ave & Linwood Ave",
    description: "Multiple callers reporting gunshots, units responding.",
    severity: 5,
    severityLabel: "critical",
    status: "Active",
    createdAt: now,
    updatedAt: now,
    point: { lat: 39.9497, lng: -82.9684 },
  },
];

