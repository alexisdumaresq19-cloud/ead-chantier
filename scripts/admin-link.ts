/**
 * The way back in for an office that has lost its last signed-in device (a
 * lost phone, a cleared browser, a link opened on the wrong device): prints a
 * fresh personal link for an active office account. The app itself cannot do
 * this, since only a signed-in office account creates links. This script
 * needs the database's address instead, which only whoever runs the
 * installation holds.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/admin-link.ts https://chantier.example.com
 *   DATABASE_URL=postgres://… npx tsx scripts/admin-link.ts https://chantier.example.com "Camille Roy"
 *
 * The second argument is the person's name (or part of it) or their id; it
 * can be left out when the office has a single account. Without DATABASE_URL
 * in the environment, .env.local is read, as the other scripts do.
 */
import { and, asc, eq } from "drizzle-orm";

import { createPersonalInvite } from "../src/server/auth";
import { db, schema, sql } from "../src/server/db/client";
import { env } from "../src/server/env";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the defaults apply.
}

const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function main(): Promise<number> {
  const [address, who] = process.argv.slice(2);
  let origin: string;
  try {
    const url = new URL(address ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    origin = url.origin;
  } catch {
    console.error(
      'Usage : npx tsx scripts/admin-link.ts <adresse du site> ["nom" ou identifiant]\n' +
        '  ex. : npx tsx scripts/admin-link.ts https://chantier.example.com "Camille Roy"',
    );
    return 1;
  }

  const database = new URL(env.databaseUrl);
  console.log(`Base de données : ${database.host}${database.pathname}`);
  const office = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
  if (!office.length) {
    console.error(
      "Aucun compte actif du bureau dans cette base. Si l'application est neuve, créez le premier compte à l'adresse /demarrer.",
    );
    return 1;
  }

  const list = () => office.map((person) => `  ${person.id}  ${person.name}`).join("\n");
  let matches = office;
  if (who) {
    const exact = office.filter((p) => p.id === who || fold(p.name) === fold(who));
    matches = exact.length ? exact : office.filter((p) => fold(p.name).includes(fold(who)));
  }
  if (matches.length !== 1) {
    console.error(
      (who
        ? matches.length
          ? `Plusieurs comptes du bureau correspondent à « ${who} ».`
          : `Aucun compte actif du bureau ne correspond à « ${who} ».`
        : "Le bureau a plusieurs comptes : indiquez le nom ou l'identifiant.") +
        `\nComptes actifs du bureau :\n${list()}`,
    );
    return 1;
  }

  const [person] = matches;
  const { token, code } = await createPersonalInvite(person.id, person.id);
  console.log(
    `\nLien personnel de ${person.name} :\n\n  ${origin}/i/${token}\n\n` +
      `Ou, dans l'application, avec son cellulaire et le code ${code.slice(0, 4)} ${code.slice(4)}.\n` +
      "Il sert une seule fois, pendant 14 jours, et remplace les liens déjà envoyés à cette personne.\n" +
      "À ouvrir sur l'appareil à connecter. Ne le transmettez qu'à elle.",
  );
  return 0;
}

main()
  .catch((error) => {
    console.error(error);
    return 1;
  })
  .then(async (code) => {
    await sql.end();
    process.exit(code);
  });
