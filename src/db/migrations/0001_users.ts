import { Kysely, sql } from "kysely"

export const up = async (db: Kysely<any>) => {
    await db.schema.createTable('users').addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("firebase_id", "text", (col) => col.unique().notNull())
        .addColumn("username", "text", (col) => col.unique().notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute()

    await db.schema.createTable('user_videos').addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
        .addColumn("video_id", "uuid", (col) => col.notNull().references("videos.id"))
        .addPrimaryKeyConstraint("user_videos_pkey", ["user_id", "video_id"])
        .execute()
}

export const down = async (db: Kysely<any>) => {
    await db.schema.dropTable('user_videos').execute()
    await db.schema.dropTable('users').execute()
}