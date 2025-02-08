import type { Generated } from "kysely";

export interface Database {
    videos: VideoTable;
    users: UserTable;
}

export interface VideoTable {
    id: Generated<string>;
    key: string;
    created_at: Generated<Date>;
    uploader: string;
}

export interface UserTable {
    id: Generated<string>;
    firebase_id: string;
    username: string;
    created_at: Generated<Date>;
}
