import { Kysely, sql } from "kysely";

export const up = async (db: Kysely<any>) => {
    await db.schema.createTable('videos').addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("key", "text", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute()
}

export const down = async (db: Kysely<any>) => {
    await db.schema.dropTable('videos').execute()
}
