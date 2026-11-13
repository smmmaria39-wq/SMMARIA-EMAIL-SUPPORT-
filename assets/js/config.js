// ===============================================
// Firebase Admin SDK Initialization
// ===============================================
//
// Required environment variables (use the SAME service account
// as the main SMMMARIA backend):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY    (with \n escaped line breaks)
//   FIREBASE_DATABASE_URL
//

import admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';

const requiredVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_DATABASE_URL'
];

for (const variable of requiredVars) {
    if (!process.env[variable]) {
        throw new Error(
            `[FIREBASE CONFIG] Missing environment variable: ${variable}`
        );
    }
}

// Initialize Firebase only once.
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    console.log('[FIREBASE] Admin SDK initialized successfully.');
}

export const db = admin.database();

/** Resolve the configured Firebase Storage bucket only when an upload is requested. */
export const getStorageBucket = () => {
    const bucketName = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
    if (!bucketName) {
        const error = new Error('FIREBASE_STORAGE_BUCKET is not configured.');
        error.statusCode = 503;
        throw error;
    }
    return getStorage().bucket(bucketName);
};

/**
 * Get a Firebase Realtime Database reference.
 */
export const getRef = (path) => {
    if (typeof path !== 'string' || !path.trim()) {
        throw new Error('A valid Firebase database path is required.');
    }

    return db.ref(path);
};

export default db;
