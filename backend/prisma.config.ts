import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const envFileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
const envFilePath = fileURLToPath(new URL(`./${envFileName}`, import.meta.url));

if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be defined for Prisma commands');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
