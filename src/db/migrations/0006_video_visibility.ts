import { Kysely, sql } from 'kysely';
import { Type } from '../extensions/with_schemable_types.js';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.createType('video_visibility').asEnum(['public', 'private']).execute();

    await db.schema
        .alterTable('videos')
        .addColumn('visibility', sql`${new Type('video_visibility')}`, (col) => col.notNull().defaultTo('private'))
        .execute();

    // Set all existing videos to public since they were created before visibility was added
    await db
        .updateTable('videos')
        .set({ visibility: 'public' })
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('videos')
        .dropColumn('visibility')
        .execute();

    await db.schema.dropType('video_visibility').execute();
}
