export function isSqlite(): boolean {
  return (process.env.DB_TYPE || 'postgres').toLowerCase() === 'sqlite';
}

export function dbType(): 'postgres' | 'sqlite' {
  return isSqlite() ? 'sqlite' : 'postgres';
}
