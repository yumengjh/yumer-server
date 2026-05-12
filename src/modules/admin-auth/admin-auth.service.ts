import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Admin } from '../../entities/admin.entity';
import { hashPassword, comparePassword } from '../../common/utils/hash.util';
import { generateAdminId } from '../../common/utils/id-generator.util';

@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    const existing = await this.adminRepository.findOne({ where: { username: 'admin' } });
    if (!existing) {
      const passwordHash = await hashPassword('admin123');
      await this.adminRepository.save({
        adminId: generateAdminId(),
        username: 'admin',
        passwordHash,
        displayName: '管理员',
        avatar: '',
        status: 'active',
        role: 'super_admin',
        permissions: ['*'],
      });
      console.log('[AdminAuth] Default admin created: admin / admin123');
    }
  }

  async login(username: string, password: string) {
    const admin = await this.adminRepository.findOne({ where: { username } });
    if (!admin || !(await comparePassword(password, admin.passwordHash))) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (admin.status !== 'active') {
      throw new UnauthorizedException('管理员已被禁用');
    }

    admin.lastLoginAt = new Date();
    await this.adminRepository.save(admin);

    const tokens = this.generateTokens(admin);

    return {
      success: true,
      data: {
        avatar: admin.avatar || '',
        username: admin.username,
        nickname: admin.displayName || admin.username,
        roles: [admin.role],
        permissions: admin.permissions,
        ...tokens,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.adminRefreshSecret'),
      });

      const admin = await this.adminRepository.findOne({
        where: { adminId: payload.adminId },
      });

      if (!admin || admin.status !== 'active') {
        throw new UnauthorizedException('管理员不存在或已被禁用');
      }

      const tokens = this.generateTokens(admin);

      return {
        success: true,
        data: tokens,
      };
    } catch {
      throw new UnauthorizedException('刷新令牌无效');
    }
  }

  getAsyncRoutes() {
    return [];
  }

  private generateTokens(admin: Admin) {
    const payload = { adminId: admin.adminId };

    const expiresIn = this.configService.get<string>('jwt.adminExpiresIn') || '24h';
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.adminSecret'),
      expiresIn: expiresIn as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.adminRefreshSecret'),
      expiresIn: (this.configService.get<string>('jwt.adminRefreshExpiresIn') || '7d') as any,
    });

    const expires = new Date(Date.now() + this.parseExpiresIn(expiresIn));
    const expiresStr = expires.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '/');

    return { accessToken, refreshToken, expires: expiresStr };
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * multipliers[unit];
  }
}
