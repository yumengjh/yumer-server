import { ForbiddenException, Injectable, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  IS_PUBLIC_KEY,
  IS_SITE_PUBLIC_KEY,
  SITE_PUBLIC_ANONYMOUS_USER_ID,
} from '../decorators/public.decorator';
import { isOriginAllowedByPatterns, normalizeOrigin } from '../utils/site-origin.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const isSitePublic = this.reflector.getAllAndOverride<boolean>(IS_SITE_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isSitePublic) {
      return super.canActivate(context);
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Record<string, unknown> }>();
    if (this.hasAuthorizationHeader(request)) {
      return super.canActivate(context);
    }

    if (!this.isAllowedSiteRequest(request)) {
      throw new ForbiddenException('Request origin is not allowed for site public access');
    }

    request.user = {
      userId: SITE_PUBLIC_ANONYMOUS_USER_ID,
      accessMode: 'site-public',
    };
    return true;
  }

  private hasAuthorizationHeader(request: Request): boolean {
    const authorization = request.headers.authorization;
    return typeof authorization === 'string' && authorization.trim().length > 0;
  }

  private isAllowedSiteRequest(request: Request): boolean {
    const requestOrigin = this.resolveRequestOrigin(request);
    const allowedOrigins = this.configService.get<string[]>('runtime.publicSiteOrigins') ?? [];
    if (!requestOrigin) {
      return this.configService.get<boolean>('runtime.publicSiteAllowNoOrigin') ?? false;
    }

    return isOriginAllowedByPatterns(requestOrigin, allowedOrigins);
  }

  private resolveRequestOrigin(request: Request): string | null {
    const originHeader = this.getSingleHeaderValue(request.headers.origin);
    const normalizedOrigin = this.normalizeOrigin(originHeader);
    if (normalizedOrigin) {
      return normalizedOrigin;
    }

    const refererHeader = this.getSingleHeaderValue(request.headers.referer);
    if (!refererHeader) {
      return null;
    }

    try {
      return new URL(refererHeader).origin.toLowerCase();
    } catch {
      return null;
    }
  }

  private getSingleHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private normalizeOrigin(value: string | undefined): string | null {
    if (!value || !value.trim()) {
      return null;
    }

    return normalizeOrigin(value);
  }
}
