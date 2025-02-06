import type { Generated } from "kysely";

export interface Database {
    videos: VideoTable;
    users: UserTable;
    user_videos: UserVideoTable;
}

export interface VideoTable {
    id: Generated<string>;
    key: string;
    created_at: Generated<Date>;
}

export interface UserTable {
    id: Generated<string>;
    firebase_id: string;
    username: string;
    created_at: Generated<Date>;
}

export interface UserVideoTable {
    user_id: string;
    video_id: string;
}
