import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuntimeConfig } from '../../entities/runtime-config.entity';
import { SystemAdminTokenGuard } from '../../common/guards/system-admin-token.guard';
import { RuntimeConfigController } from './runtime-config.controller';
import { RuntimeConfigService } from './runtime-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([RuntimeConfig])],
  controllers: [RuntimeConfigController],
  providers: [RuntimeConfigService, SystemAdminTokenGuard],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
