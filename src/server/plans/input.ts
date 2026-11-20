import { z } from "zod";

/** A calendar day ("2026-10-01") that exists, and that the database can store. */
export const dayInput = z.iso.date().refine((day) => day >= "0001-01-01", "Date invalide.");
