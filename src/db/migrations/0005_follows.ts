import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('follows')
        .addColumn('follower_id', 'uuid', (col) => 
            col.references('users.id').notNull()
        )
        .addColumn('followed_id', 'uuid', (col) => 
            col.references('users.id').notNull()
        )
        .addColumn('created_at', 'timestamptz', (col) => 
            col.defaultTo(sql`now()`).notNull()
        )
        .addPrimaryKeyConstraint('follows_pkey', ['follower_id', 'followed_id'])
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('follows').execute();
}
