import { PrismaClient } from '@prisma/client'
const cache = globalThis as typeof globalThis & { messagingDb?: PrismaClient }
export const db = cache.messagingDb ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') cache.messagingDb = db
