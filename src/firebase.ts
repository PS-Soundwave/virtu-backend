import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from './env.js';

// Initialize Firebase Admin
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    // Firebase private key comes as a string with escaped newlines
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});

export const auth = getAuth(app);
