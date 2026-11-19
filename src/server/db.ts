import mongoose from 'mongoose';
import { Logger } from './logger';

const log = new Logger('Mongo');

interface Cache {
  conn: Promise<typeof mongoose> | null;
}
const g = globalThis as unknown as { __mongo?: Cache };
const cache: Cache = (g.__mongo ??= { conn: null });

/**
 * One cached connection per server instance (serverless-safe). The first connection also runs the
 * one-off index migration the Nest PostsService did in onModuleInit.
 */
export function connectDb(): Promise<typeof mongoose> {
  if (!cache.conn) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Configuration key "MONGODB_URI" does not exist');
    cache.conn = mongoose
      .connect(uri, { bufferCommands: false })
      .then(async (m) => {
        await migrateIndexes();
        return m;
      })
      .catch((e) => {
        cache.conn = null;
        throw e;
      });
  }
  return cache.conn;
}

async function migrateIndexes() {
  const { PostModel } = await import('./models/post');
  try {
    await PostModel.collection.dropIndex('userId_1_scheduledAt_1');
    log.log('Dropped legacy slot index userId_1_scheduledAt_1');
  } catch {
    /* already gone / never existed */
  }
  await PostModel.syncIndexes().catch((e: Error) => log.warn(`syncIndexes: ${e.message}`));
}
