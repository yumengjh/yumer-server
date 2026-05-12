import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityLog } from '../../entities/security-log.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { SecurityService } from './security.service';
import { AuditService } from './audit.service';
import { SecurityController } from './security.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SecurityLog, AuditLog])],
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [SecurityService, AuditService],
})
export class SecurityModule {}
