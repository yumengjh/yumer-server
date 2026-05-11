import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../../entities/user.entity';
import { Session } from '../../entities/session.entity';
import { hashPassword, comparePassword } from '../../common/utils/hash.util';
import { generateUserId, generateSessionId } from '../../common/utils/id-generator.util';
import { SecurityService } from '../security/security.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateMeDto } from './dto/update-me.dto';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private securityService: SecurityService,
  ) {}

  async register(registerDto: RegisterDto) {
    // 检查用户名是否已存在
    const existingUser = await this.userRepository.findOne({
      where: [{ username: registerDto.username }, { email: registerDto.email }],
    });

    if (existingUser) {
      throw new ConflictException('用户名或邮箱已存在');
    }

    // 加密密码
    const passwordHash = await hashPassword(registerDto.password);

    // 创建用户
    const user = this.userRepository.create({
      userId: generateUserId(),
      username: registerDto.username,
      email: registerDto.email,
      passwordHash,
      displayName: registerDto.displayName || registerDto.username,
      status: 'active',
      settings: {},
    });

    await this.userRepository.save(user);

    // 生成 token
    const tokens = await this.generateTokens(user.userId);

    // 创建会话
    await this.createSession(user.userId, tokens);

    return {
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
      },
      ...tokens,
    };
  }

  async login(loginDto: LoginDto, ctx?: RequestContext) {
    const user = await this.validateUser(loginDto.emailOrUsername, loginDto.password);

    if (!user) {
      this.securityService
        .logLoginFailed({
          ipAddress: ctx?.ip || '0.0.0.0',
          userAgent: ctx?.userAgent,
          email: loginDto.emailOrUsername,
          reason: 'Invalid credentials',
        })
        .catch(() => {});
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 更新最后登录时间
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // 生成 token
    const tokens = await this.generateTokens(user.userId);

    // 创建会话
    await this.createSession(user.userId, tokens);

    this.securityService
      .logLoginSuccess({
        userId: user.userId,
        email: user.email,
        ipAddress: ctx?.ip || '0.0.0.0',
        userAgent: ctx?.userAgent,
      })
      .catch(() => {});

    return {
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
      },
      ...tokens,
    };
  }

  async validateUser(emailOrUsername: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: [{ email: emailOrUsername }, { username: emailOrUsername }],
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('用户已被禁用');
    }

    return user;
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      const user = await this.userRepository.findOne({
        where: { userId: payload.userId },
      });

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('用户不存在或已被禁用');
      }

      // 验证会话
      const session = await this.sessionRepository.findOne({
        where: {
          userId: user.userId,
          refreshToken,
        },
      });

      if (!session || session.expiresAt < new Date()) {
        throw new UnauthorizedException('刷新令牌无效或已过期');
      }

      // 生成新 token
      const tokens = await this.generateTokens(user.userId);

      // 更新会话
      session.token = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      // refreshExpiresIn 是字符串格式（如 "7d"），需要解析
      const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn') || '7d';
      const expiresAt = new Date();
      if (refreshExpiresIn.endsWith('d')) {
        const days = parseInt(refreshExpiresIn, 10);
        expiresAt.setDate(expiresAt.getDate() + days);
      } else if (refreshExpiresIn.endsWith('h')) {
        const hours = parseInt(refreshExpiresIn, 10);
        expiresAt.setHours(expiresAt.getHours() + hours);
      } else {
        // 默认7天
        expiresAt.setDate(expiresAt.getDate() + 7);
      }
      session.expiresAt = expiresAt;
      session.lastActivityAt = new Date();
      await this.sessionRepository.save(session);

      return tokens;
    } catch {
      throw new UnauthorizedException('刷新令牌无效');
    }
  }

  async logout(userId: string, token: string, ctx?: RequestContext) {
    // 删除会话
    await this.sessionRepository.delete({
      userId,
      token,
    });
    this.securityService
      .logLogout({
        userId,
        ipAddress: ctx?.ip || '0.0.0.0',
        userAgent: ctx?.userAgent,
      })
      .catch(() => {});
  }

  async getCurrentUser(userId: string) {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: [
        'userId',
        'username',
        'email',
        'displayName',
        'avatar',
        'bio',
        'settings',
        'createdAt',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }

  async getUserProfileByUserId(
    userId: string,
    accessMode: 'authenticated' | 'site-public' = 'authenticated',
  ) {
    const isSitePublic = accessMode === 'site-public';
    const select = isSitePublic
      ? ['userId', 'username', 'displayName', 'avatar', 'bio', 'updatedAt']
      : ['userId', 'username', 'displayName', 'email', 'avatar', 'bio', 'status', 'updatedAt'];
    const user = await this.userRepository.findOne({
      where: { userId },
      select: select as (keyof User)[],
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (isSitePublic) {
      return {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        updatedAt: user.updatedAt,
      };
    }

    return {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      status: user.status,
      updatedAt: user.updatedAt,
    };
  }

  async updateCurrentUser(userId: string, updateMeDto: UpdateMeDto) {
    const user = await this.userRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    let changed = false;

    if (updateMeDto.displayName !== undefined && updateMeDto.displayName !== null) {
      user.displayName = updateMeDto.displayName;
      changed = true;
    }

    if (updateMeDto.avatar !== undefined && updateMeDto.avatar !== null) {
      user.avatar = updateMeDto.avatar;
      changed = true;
    }

    if (updateMeDto.bio !== undefined && updateMeDto.bio !== null) {
      user.bio = updateMeDto.bio;
      changed = true;
    }

    if (changed) {
      await this.userRepository.save(user);
    }

    const currentUser = await this.userRepository.findOne({
      where: { userId },
      select: [
        'userId',
        'username',
        'email',
        'displayName',
        'avatar',
        'bio',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!currentUser) {
      throw new UnauthorizedException('用户不存在');
    }

    return currentUser;
  }

  private async generateTokens(userId: string) {
    const payload = { userId };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: this.configService.get<string>('jwt.expiresIn'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private async createSession(
    userId: string,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7天后过期

    const session = this.sessionRepository.create({
      sessionId: generateSessionId(),
      userId,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
      deviceInfo: {},
    });

    await this.sessionRepository.save(session);
  }
}
