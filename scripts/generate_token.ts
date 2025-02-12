import { auth } from '../src/firebase.js';
import { db } from '../src/db/index.js';

async function generateTestToken() {
    try {
        // Create a custom token for a test user
        const uid = 'test-user';
        const customToken = await auth.createCustomToken(uid);
        
        // Make sure the user exists in the database
        const existingUser = await db
            .selectFrom('users')
            .where('firebase_id', '=', uid)
            .executeTakeFirst();
            
        if (!existingUser) {
            await db
                .insertInto('users')
                .values({
                    firebase_id: uid,
                    username: 'test-user'
                })
                .execute();
        }

        console.log('Custom Token:', customToken);
        console.log('\nTo get an ID token, make this HTTP request:');
        console.log(`curl -X POST 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=YOUR_WEB_API_KEY' \\
    -H 'Content-Type: application/json' \\
    --data-raw '{"token":"${customToken}","returnSecureToken":true}'`);
        
    } catch (error) {
        console.error('Error generating token:', error);
    } finally {
        process.exit();
    }
}

generateTestToken();
