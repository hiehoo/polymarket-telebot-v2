import fs from 'fs';
import path from 'path';
import databasePool from '../src/services/database/connection-pool';
import logger from '../src/utils/logger';

async function initDb() {
    try {
        logger.info('Starting database initialization...');

        const migrationFile = path.join(__dirname, '../src/services/database/migrations/001-initial-schema.sql');

        if (!fs.existsSync(migrationFile)) {
            throw new Error(`Migration file not found at: ${migrationFile}`);
        }

        const sql = fs.readFileSync(migrationFile, 'utf8');

        logger.info('Executing migration script...');

        // Split by semicolons to execute statements individually if needed, 
        // but pg driver can handle multiple statements in one query usually.
        // However, for safety and better error reporting, we might want to run it as one block 
        // or split it. The file has complex blocks like DO $$, so simple splitting might break it.
        // Let's try running it as a single query first.

        await databasePool.query(sql);

        logger.info('Database initialization completed successfully.');
    } catch (error) {
        logger.error('Database initialization failed:', error);
        process.exit(1);
    } finally {
        await databasePool.close();
    }
}

initDb();
