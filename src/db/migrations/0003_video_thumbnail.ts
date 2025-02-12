import { Kysely } from "kysely";

export const up = async (db: Kysely<any>) => {
    await db.schema.alterTable('videos').addColumn("thumbnail_key", "text", (col) => col.notNull()).execute();
}

export const down = async (db: Kysely<any>) => {
    await db.schema.alterTable('videos').dropColumn("thumbnail_key").execute();
}
