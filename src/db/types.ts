import type { Generated } from "kysely";

export interface Database {
    videos: VideoTable;
    users: UserTable;
    subtitles: SubtitleTable;
}

export interface VideoTable {
    id: Generated<string>;
    key: string;
    created_at: Generated<Date>;
    uploader: string;
    thumbnail_key: string;
}

export interface UserTable {
    id: Generated<string>;
    firebase_id: string;
    username: string;
    created_at: Generated<Date>;
}


export interface SubtitleTable {
    id: Generated<string>;
    video_id: string;
    start_time: number;
    end_time: number;
    text: string;
    created_at: Generated<Date>;
}
