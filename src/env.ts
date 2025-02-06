import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { config } from 'dotenv';

config();

export const env = createEnv({
    server: {
        AWS_REGION: z.string(),
        MEDIACONVERT_ENDPOINT: z.string().url(),
        MEDIACONVERT_ROLE: z.string(),
        S3_BUCKET: z.string(),
        DATABASE_URL: z.string()
    },
    runtimeEnv: process.env
});