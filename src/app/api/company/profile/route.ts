import { requireAdmin } from "@/server/auth";
import {
  companyProfileInput,
  readCompanyProfile,
  writeCompanyProfile,
} from "@/server/company/profile";
import { body, route } from "@/server/http";
import type { CompanyProfile } from "@/shared/company";

// The company's public contact details, for the office only: read them, or
// replace them all at once (the card's sheet sends every field).

export const GET = route(async (request) => {
  await requireAdmin(request);
  return (await readCompanyProfile()) satisfies CompanyProfile;
});

export const PUT = route(async (request) => {
  const admin = await requireAdmin(request);
  const profile = await body(request, companyProfileInput);
  await writeCompanyProfile(profile, admin.id);
  return (await readCompanyProfile()) satisfies CompanyProfile;
});
