import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SystemAdminTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedToken = (this.configService.get<string>('runtime.systemAdminToken') || '').trim();

    if (!expectedToken) {
      throw new ForbiddenException('系统管理员令牌未配置，禁止运行时配置修改');
    }

    const request = context.switchToHttp().getRequest();
    const incomingHeader = request.headers?.['x-system-admin-token'];
    const actualToken = Array.isArray(incomingHeader) ? incomingHeader[0] : incomingHeader;

    if (!actualToken || actualToken.trim() !== expectedToken) {
      throw new ForbiddenException('系统管理员令牌无效');
    }

    return true;
  }
}
