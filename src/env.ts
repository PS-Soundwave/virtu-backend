import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { config } from 'dotenv';

config();

export const env = createEnv({
    server: {
        AWS_REGION: z.string(),
        AWS_ACCESS_KEY_ID: z.string(),
        AWS_SECRET_ACCESS_KEY: z.string(),
        OPENAI_API_KEY: z.string(),
        MEDIACONVERT_ENDPOINT: z.string().url(),
        MEDIACONVERT_ROLE: z.string(),
        S3_BUCKET: z.string(),
        DATABASE_URL: z.string(),
        FIREBASE_PROJECT_ID: z.string(),
        FIREBASE_CLIENT_EMAIL: z.string(),
        FIREBASE_PRIVATE_KEY: z.string()
    },
    runtimeEnv: process.env
});