import type { Generated } from "kysely";

export interface Database {
    videos: VideoTable;
}

export interface VideoTable {
    id: Generated<string>;
    key: string;
    created_at: Generated<Date>;
}
