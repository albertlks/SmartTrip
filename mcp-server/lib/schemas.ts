import * as z from "zod";
import { isIsoDate } from "./results";

export const airportCode = (field: string) =>
  z
    .string()
    .regex(/^[A-Za-z]{3}$/, `${field} must be a 3-letter IATA airport code, e.g. "SEA" or "HNL".`)
    .transform((s) => s.toUpperCase());

export const isoDate = (field: string) =>
  z.string().refine(isIsoDate, `${field} must be a real date in YYYY-MM-DD form, e.g. "2026-11-14".`);
