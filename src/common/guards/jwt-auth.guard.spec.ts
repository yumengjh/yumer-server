import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Public, SITE_PUBLIC_ANONYMOUS_USER_ID, SitePublic } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class TestController {
  @Public()
  publicRoute() {
    return 'public';
  }

  @SitePublic()
  sitePublicRoute() {
    return 'site-public';
  }

  protectedRoute() {
    return 'protected';
  }
}

const createHttpContext = (
  handlerName: keyof TestController,
  request: Record<string, unknown>,
): ExecutionContext =>
  ({
    getHandler: () => TestController.prototype[handlerName],
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  let guard: JwtAuthGuard;

  const mockConfig = ({
    publicSiteOrigins = [],
    publicSiteAllowNoOrigin = false,
  }: {
    publicSiteOrigins?: string[];
    publicSiteAllowNoOrigin?: boolean;
  }) => {
    jest.mocked(configService.get).mockImplementation((key: string) => {
      if (key === 'runtime.publicSiteOrigins') {
        return publicSiteOrigins;
      }
      if (key === 'runtime.publicSiteAllowNoOrigin') {
        return publicSiteAllowNoOrigin;
      }
      return undefined;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(new Reflector(), configService);
  });

  it('允许 @Public 路由直接放行', () => {
    const request = { headers: {} };

    const result = guard.canActivate(createHttpContext('publicRoute', request));

    expect(result).toBe(true);
  });

  it('允许来自白名单 Origin 的 @SitePublic 路由匿名访问', () => {
    const request = {
      headers: {
        origin: 'https://publish.example.com',
      },
    };
    mockConfig({
      publicSiteOrigins: ['https://publish.example.com', 'https://docs.example.com'],
    });

    const result = guard.canActivate(createHttpContext('sitePublicRoute', request));

    expect(result).toBe(true);
    expect(request).toMatchObject({
      user: {
        userId: SITE_PUBLIC_ANONYMOUS_USER_ID,
      },
    });
  });

  it('拒绝未在白名单中的 @SitePublic 匿名请求', () => {
    const request = {
      headers: {
        origin: 'https://evil.example.com',
      },
    };
    mockConfig({
      publicSiteOrigins: ['https://publish.example.com'],
    });

    expect(() => guard.canActivate(createHttpContext('sitePublicRoute', request))).toThrow(
      ForbiddenException,
    );
  });

  it('允许 PUBLIC_SITE_ORIGINS=* 的 @SitePublic 匿名请求', () => {
    const request = {
      headers: {
        origin: 'https://any-site.example.com',
      },
    };
    mockConfig({
      publicSiteOrigins: ['*'],
    });

    const result = guard.canActivate(createHttpContext('sitePublicRoute', request));

    expect(result).toBe(true);
    expect(request).toMatchObject({
      user: {
        userId: SITE_PUBLIC_ANONYMOUS_USER_ID,
      },
    });
  });

  it('允许命中子域通配符的 @SitePublic 匿名请求', () => {
    const request = {
      headers: {
        origin: 'https://foo.example.com',
      },
    };
    mockConfig({
      publicSiteOrigins: ['https://*.example.com'],
    });

    const result = guard.canActivate(createHttpContext('sitePublicRoute', request));

    expect(result).toBe(true);
  });

  it('允许启用 no-origin 开关后的 @SitePublic 匿名请求', () => {
    const request = {
      headers: {},
    };
    mockConfig({
      publicSiteAllowNoOrigin: true,
    });

    const result = guard.canActivate(createHttpContext('sitePublicRoute', request));

    expect(result).toBe(true);
    expect(request).toMatchObject({
      user: {
        userId: SITE_PUBLIC_ANONYMOUS_USER_ID,
      },
    });
  });

  it('在未启用 no-origin 开关时拒绝无 Origin 的 @SitePublic 匿名请求', () => {
    const request = {
      headers: {},
    };
    mockConfig({
      publicSiteOrigins: ['*'],
      publicSiteAllowNoOrigin: false,
    });

    expect(() => guard.canActivate(createHttpContext('sitePublicRoute', request))).toThrow(
      ForbiddenException,
    );
  });
});
