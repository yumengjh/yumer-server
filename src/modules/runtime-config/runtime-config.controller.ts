import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { SystemAdminTokenGuard } from '../../common/guards/system-admin-token.guard';
import { UpdateRateLimitConfigDto } from './dto/update-rate-limit-config.dto';
import { RuntimeConfigService } from './runtime-config.service';

@ApiTags('runtime-configs')
@ApiHeader({
  name: 'x-system-admin-token',
  description: '系统管理员令牌（用于运行时配置管理）',
  required: true,
})
@Controller('runtime-configs')
@SkipThrottle()
@UseGuards(SystemAdminTokenGuard)
export class RuntimeConfigController {
  constructor(private readonly runtimeConfigService: RuntimeConfigService) {}

  @Get('rate-limit')
  @ApiOperation({ summary: '读取限流运行时配置' })
  @ApiResponse({ status: 200, description: '读取成功' })
  @ApiResponse({ status: 403, description: '系统管理员令牌无效' })
  async getRateLimitConfig() {
    return this.runtimeConfigService.getRateLimitConfig();
  }

  @Patch('rate-limit')
  @ApiOperation({ summary: '更新限流运行时配置（热更新）' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 403, description: '系统管理员令牌无效' })
  async updateRateLimitConfig(@Body() body: UpdateRateLimitConfigDto, @Req() request: Request) {
    return this.runtimeConfigService.updateRateLimitConfig(body, this.resolveOperator(request));
  }

  @Post('rate-limit/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重置限流运行时配置为默认值' })
  @ApiResponse({ status: 200, description: '重置成功' })
  @ApiResponse({ status: 403, description: '系统管理员令牌无效' })
  async resetRateLimitConfig(@Req() request: Request) {
    return this.runtimeConfigService.resetRateLimitConfig(this.resolveOperator(request));
  }

  private resolveOperator(request: Request): string {
    const operatorHeader = request.headers['x-operator-id'];
    const operator = Array.isArray(operatorHeader) ? operatorHeader[0] : operatorHeader;

    if (operator && operator.trim().length > 0) {
      return operator.trim().slice(0, 64);
    }

    return request.ip || 'system_admin';
  }
}
