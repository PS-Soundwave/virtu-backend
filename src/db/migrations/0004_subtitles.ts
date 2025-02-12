import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('subtitles')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('video_id', 'uuid', (col) => 
            col.references('videos.id').notNull()
        )
        .addColumn('start_time', 'numeric', (col) => col.notNull())
        .addColumn('end_time', 'numeric', (col) => col.notNull())
        .addColumn('text', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => 
            col.defaultTo(sql`now()`).notNull()
        )
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('subtitles').execute();
}
