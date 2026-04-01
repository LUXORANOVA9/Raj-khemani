import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().default('postgresql://teen_patti:dev_password@localhost:5432/teen_patti_dev'),
  DATABASE_POOL_SIZE: z.coerce.number().default(20),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Auth
  JWT_SECRET: z.string().default('dev-secret-change-in-production'),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  // Socket.IO
  SOCKET_CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  SOCKET_PING_INTERVAL: z.coerce.number().default(10000),
  SOCKET_PING_TIMEOUT: z.coerce.number().default(5000),

  // Game
  DEFAULT_COMMISSION_RATE: z.coerce.number().default(0.05),
  MAX_TABLES_PER_NODE: z.coerce.number().default(500),
  MAX_CONNECTIONS_PER_NODE: z.coerce.number().default(3000),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.format();
    throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
  }
  return parsed.data;
}

export const env = loadEnv();
