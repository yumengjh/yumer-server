import { registerAs } from '@nestjs/config';
import { isSqlite } from '../common/db-type';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

export default registerAs('database', () => {
  const sqlite = isSqlite();

  if (sqlite) {
    return {
      type: 'better-sqlite3' as const,
      database: process.env.DB_SQLITE_PATH || './data/app.db',
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV === 'development',
      logging: parseBoolean(process.env.DB_LOGGING, false),
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      migrationsRun: false,
    };
  }

  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'knowledge_base',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: process.env.NODE_ENV === 'development',
    logging: parseBoolean(process.env.DB_LOGGING, false),
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    migrationsRun: false,
    extra: {
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
      min: parseInt(process.env.DB_MIN_CONNECTIONS || '5', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  };
});
