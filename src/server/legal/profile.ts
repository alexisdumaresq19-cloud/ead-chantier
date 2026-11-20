import { connection } from "next/server";

import { EMPTY_COMPANY_PROFILE, type CompanyProfile } from "@/shared/company";

import { readCompanyProfile } from "../company/profile";

// What the two public pages show of the company. Read at each visit (the
// office may have just filled it in), and never a reason for a legal page
// to fail: without the database, the page still says everything else.

export async function profileForPages(): Promise<CompanyProfile> {
  // Read when someone asks, never once and for all when the app is built.
  await connection();
  try {
    return await readCompanyProfile();
  } catch (error) {
    console.error("legal pages: company profile", error);
    return EMPTY_COMPANY_PROFILE;
  }
}

/** The date of the privacy policy's version in force, "2026-11-20". */
export const POLICY_VERSION = "2026-11-20";
