import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { AuditService } from './audit.service';
import { QuerySecurityLogsDto } from './dto/query-security-logs.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('security')
@Controller('security')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SecurityController {
  constructor(
    private readonly securityService: SecurityService,
    private readonly auditService: AuditService,
  ) {}

  @Get('events')
  @ApiOperation({ summary: '查询安全日志（安全事件）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getSecurityLogs(@Query() dto: QuerySecurityLogsDto) {
    return this.securityService.findFiltered({
      eventType: dto.eventType,
      userId: dto.userId,
      ipAddress: dto.ip,
      startDate: dto.startDate,
      endDate: dto.endDate,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @Get('audit')
  @ApiOperation({ summary: '查询审计日志' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getAuditLogs(@Query() dto: QueryAuditLogsDto) {
    return this.auditService.findFiltered({
      userId: dto.userId,
      action: dto.action,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }
}
