import { Kysely } from "kysely";

export const up = async (db: Kysely<any>) => {
    await db.schema.alterTable('videos').addColumn("uploader", "uuid", (col) => col.notNull().references("users.id")).execute();

    await db.schema.dropTable('user_videos').execute();
}

export const down = async (db: Kysely<any>) => {
    await db.schema.createTable('user_videos').addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
        .addColumn("video_id", "uuid", (col) => col.notNull().references("videos.id"))
        .addPrimaryKeyConstraint("user_videos_pkey", ["user_id", "video_id"])
        .execute();

    await db.schema.alterTable('videos').dropColumn("uploader").execute();
}
