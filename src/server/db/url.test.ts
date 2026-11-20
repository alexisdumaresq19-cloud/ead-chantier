import { describe, expect, it } from "vitest";

import { cleanDatabaseUrl } from "./url";

describe("cleanDatabaseUrl", () => {
  it("drops the settings a hosting integration adds, and keeps the encryption one", () => {
    expect(
      cleanDatabaseUrl(
        "postgres://u:p@db.example.com:6543/postgres?sslmode=require&supa=base-pooler.x",
      ),
    ).toBe("postgres://u:p@db.example.com:6543/postgres?sslmode=require");
    expect(cleanDatabaseUrl("postgres://u:p@db.example.com:6543/postgres?pgbouncer=true")).toBe(
      "postgres://u:p@db.example.com:6543/postgres",
    );
  });

  it("leaves a plain address as it is", () => {
    expect(cleanDatabaseUrl("postgres://ead:ead@127.0.0.1:54329/ead")).toBe(
      "postgres://ead:ead@127.0.0.1:54329/ead",
    );
  });

  it("keeps a password with special characters intact", () => {
    const url = "postgres://user:p%40ss%2Fw0rd@host:5432/db?sslmode=require";
    expect(cleanDatabaseUrl(url)).toBe(url);
  });
});
