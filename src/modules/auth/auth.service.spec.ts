import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { User } from '../../entities/user.entity';
import type { Session } from '../../entities/session.entity';
import { SecurityService } from '../security/security.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const userRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<User>;
  const sessionRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  } as unknown as Repository<Session>;
  const jwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  } as unknown as JwtService;
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;
  const securityService = {
    logLoginFailed: jest.fn(),
    logLoginSuccess: jest.fn(),
    logLogout: jest.fn(),
  } as unknown as SecurityService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      userRepository,
      sessionRepository,
      jwtService,
      configService,
      securityService,
    );
  });

  it('公开访问作者资料时不返回邮箱', async () => {
    jest.mocked(userRepository.findOne).mockResolvedValue({
      userId: 'user_123',
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatar: 'https://cdn.example.com/alice.png',
      bio: 'writer',
      status: 'active',
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    } as User);

    const result = await service.getUserProfileByUserId('user_123', 'site-public');

    expect(result).toEqual({
      userId: 'user_123',
      username: 'alice',
      displayName: 'Alice',
      avatar: 'https://cdn.example.com/alice.png',
      bio: 'writer',
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    });
  });

  it('登录态访问作者资料时保留现有邮箱字段', async () => {
    jest.mocked(userRepository.findOne).mockResolvedValue({
      userId: 'user_123',
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatar: 'https://cdn.example.com/alice.png',
      bio: 'writer',
      status: 'active',
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    } as User);

    const result = await service.getUserProfileByUserId('user_123', 'authenticated');

    expect(result).toEqual({
      userId: 'user_123',
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatar: 'https://cdn.example.com/alice.png',
      bio: 'writer',
      status: 'active',
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    });
  });

  it('作者不存在时仍然抛出 404', async () => {
    jest.mocked(userRepository.findOne).mockResolvedValue(null);

    await expect(service.getUserProfileByUserId('missing_user', 'site-public')).rejects.toThrow(
      NotFoundException,
    );
  });
});
