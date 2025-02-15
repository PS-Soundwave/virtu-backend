import { Kysely, Migrator, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "../env.js";
import type { Database } from "./types.js";
import { promises } from "fs";
import path from "path";
import { FileMigrationProvider } from "kysely";
import { WithSchemableTypesPlugin } from "./extensions/with_schemable_types.js";

const dialect = new PostgresDialect({
    pool: new pg.Pool({
        connectionString: env.DATABASE_URL
    })
})

export const db = new Kysely<Database>({
    dialect
}).withPlugin(new WithSchemableTypesPlugin('virtu')).withSchema('virtu')

export const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
        fs: promises,
        path,
        migrationFolder: path.join(import.meta.dirname, "migrations")
    })
})