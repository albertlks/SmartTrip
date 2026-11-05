import type { TripRequest } from "@/agent/recordRequest";
import { formatDayRange, formatMoney } from "./format";

// The request chips on the results page: what the agent understood (from the saved request, never its prose),
// and the plain message each edit sends as a follow-up in the same conversation.

export type ChipField = "origin" | "destinations" | "dates" | "travelers" | "budget";

export type ChipView =
  | { kind: "field"; field: ChipField; label: string; value: string; note?: string; missing: boolean }
  | { kind: "preference"; label: string; value: string };

export type RequestEdit =
  | { field: "origin" | "destinations"; value: string }
  | { field: "dates"; departDate: string; returnDate: string }
  | { field: "travelers" | "budget"; value: number }
  | { field: "removePreference"; value: string };

const NOT_SET = "Not set";

export function toChips(r: TripRequest): ChipView[] {
  const field = (f: ChipField, label: string, value: string | null, note?: string): ChipView => ({
    kind: "field",
    field: f,
    label,
    value: value ?? NOT_SET,
    note: value === null ? undefined : note,
    missing: value === null,
  });
  return [
    field("origin", "From", r.origin),
    field("destinations", "To", r.destinations.length ? r.destinations.join(", ") : null, r.destinationsFromIdeas ? "suggested" : undefined),
    field("dates", "Dates", r.departDate && r.returnDate ? formatDayRange(r.departDate, r.returnDate) : null),
    field("travelers", "Travelers", String(r.travelers), r.travelersDefaulted ? "assumed" : undefined),
    field("budget", "Budget", r.budget === null ? null : formatMoney(r.budget)),
    ...r.preferences.map((p): ChipView => ({ kind: "preference", label: "Prefers", value: p })),
  ];
}

const KEEP = " Keep everything else the same.";

/** The follow-up message for an edit, e.g. "Change the budget to $1,200. Keep everything else the same." */
export function editMessage(edit: RequestEdit): string {
  switch (edit.field) {
    case "origin":
      return `Change the starting city to ${edit.value}.${KEEP}`;
    case "destinations":
      return `Change the destination to ${edit.value}.${KEEP}`;
    case "dates": {
      const range = `${formatDayRange(edit.departDate, edit.returnDate)}, ${edit.returnDate.slice(0, 4)}`;
      return `Change the dates to ${range} (depart ${edit.departDate}, return ${edit.returnDate}).${KEEP}`;
    }
    case "travelers":
      return `Change the number of travelers to ${edit.value}.${KEEP}`;
    case "budget":
      return `Change the total budget to ${formatMoney(edit.value)}.${KEEP}`;
    case "removePreference":
      return `Drop the preference "${edit.value}".${KEEP}`;
  }
}

export type EditInput = { value?: string; departDate?: string; returnDate?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 100;

/** Checks what the user typed in a chip editor. Returns the edit, or a message to show next to the field. */
export function parseEdit(field: ChipField, input: EditInput): { edit: RequestEdit } | { error: string } {
  const text = (input.value ?? "").trim();
  switch (field) {
    case "origin":
    case "destinations":
      if (!text) return { error: field === "origin" ? "Enter a city or airport code." : "Enter at least one destination." };
      if (text.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.` };
      return { edit: { field, value: text } };
    case "travelers": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > 9) return { error: "Enter a whole number from 1 to 9." };
      return { edit: { field, value: n } };
    }
    case "budget": {
      const n = Number(text.replace(/[$,\s]/g, ""));
      if (!text || !Number.isFinite(n) || n <= 0) return { error: "Enter a budget in dollars, for example 1500." };
      if (n > 1_000_000) return { error: "That budget is too large. Enter a total in dollars." };
      return { edit: { field, value: Math.round(n) } };
    }
    case "dates": {
      const { departDate = "", returnDate = "" } = input;
      if (!ISO_DATE.test(departDate) || !ISO_DATE.test(returnDate)) return { error: "Pick both a departure and a return date." };
      if (returnDate <= departDate) return { error: "The return date must be after the departure date." };
      return { edit: { field, departDate, returnDate } };
    }
  }
}

/** What a chip editor starts with: the current value, or blank when it isn't set. */
export function editStart(field: ChipField, r: TripRequest): EditInput {
  switch (field) {
    case "origin":
      return { value: r.origin ?? "" };
    case "destinations":
      return { value: r.destinations.join(", ") };
    case "dates":
      return { departDate: r.departDate ?? "", returnDate: r.returnDate ?? "" };
    case "travelers":
      return { value: String(r.travelers) };
    case "budget":
      return { value: r.budget === null ? "" : String(r.budget) };
  }
}
