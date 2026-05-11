import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SuccessResponse } from '../dto/response.dto';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  SuccessResponse<T> | StreamableFile
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<SuccessResponse<T> | StreamableFile> {
    return next.handle().pipe(
      map((data) => {
        // 文件流等特殊类型直接返回，避免被包裹成 JSON
        if (data instanceof StreamableFile) {
          return data as any;
        }

        // 如果数据已经是标准格式 { success: true, data? }，直接返回
        if (data && typeof data === 'object' && 'success' in data && data.success === true) {
          return data;
        }

        // 否则包装为标准格式
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
