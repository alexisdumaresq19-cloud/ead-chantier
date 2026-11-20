import { appIdFrom, association } from "./association";

// The file Apple reads so that links to the site open the iPhone app. Apple's
// servers fetch it as is: 200, application/json, no redirect, no sign-in. It
// names the app by IOS_APP_ID (.env.example); without it the site has no app
// to name, and the address answers 404 like any unknown file.

// Read when asked, so that setting IOS_APP_ID needs no new build.
export const dynamic = "force-dynamic";

export function GET() {
  const value = process.env.IOS_APP_ID;
  const appId = appIdFrom(value);
  if (!appId) {
    if (value) console.error("IOS_APP_ID is set but is not TEAMID.bundle.identifier");
    return new Response(null, { status: 404 });
  }
  return Response.json(association(appId), {
    // Apple's servers keep their own copy for a while anyway.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
