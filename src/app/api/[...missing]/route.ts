import { NextResponse } from "next/server";

// Unknown API addresses answer in JSON, rather than falling through to the
// app's page.
const missing = () =>
  NextResponse.json(
    { error: { code: "not_found", message: "Adresse inconnue." } },
    { status: 404 },
  );

export { missing as DELETE, missing as GET, missing as PATCH, missing as POST, missing as PUT };
