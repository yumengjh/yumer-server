import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../../../entities/admin.entity';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    private configService: ConfigService,
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.adminSecret'),
    });
  }

  async validate(payload: { adminId: string }) {
    const admin = await this.adminRepository.findOne({
      where: { adminId: payload.adminId },
    });

    if (!admin || admin.status !== 'active') {
      throw new UnauthorizedException('管理员不存在或已被禁用');
    }

    return {
      adminId: admin.adminId,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions,
    };
  }
}
