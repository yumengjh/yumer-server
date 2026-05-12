import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const SALT_ROUNDS = 10;

/**
 * 加密密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码
 */
export async function comparePassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * 生成内容哈希 (SHA256)
 */
export function hashContent(content: string | object): string {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(contentStr).digest('hex');
}
