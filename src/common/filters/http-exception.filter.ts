import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorResponse } from '../dto/response.dto';
import { ErrorCode } from '../errors/error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const isProd = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: Record<string, any> | undefined;

    // TypeORM/PG 数据库错误映射
    const driverError = (exception as any)?.driverError;
    const pgCode = driverError?.code as string | undefined;
    if (exception instanceof QueryFailedError || driverError) {
      if (pgCode === '23505') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE_KEY';
        message = driverError?.constraint
          ? `数据写入冲突（唯一约束：${driverError.constraint}）`
          : '数据写入冲突（唯一约束冲突）';
        details = {
          dbCode: pgCode,
          constraint: driverError?.constraint,
        };
      }
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        const errorObj = exceptionResponse as any;
        message = Array.isArray(errorObj.message)
          ? errorObj.message.join(', ')
          : (errorObj.message ?? message);
        code = errorObj.code || code || exception.name;
        details = errorObj.details || details;
      } else {
        message = exceptionResponse as string;
        code = exception.name;
      }

      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = ErrorCode.RATE_LIMIT_EXCEEDED;
      }
    }

    // 记录错误日志：生产仅记录必要信息，非生产附带 stack
    const baseLog = {
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      status,
      code,
      message,
    };
    console.error(
      isProd
        ? baseLog
        : {
            ...baseLog,
            stack: exception instanceof Error ? exception.stack : undefined,
          },
    );

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
        ...(!isProd && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      },
    };

    response.status(status).json(errorResponse);
  }
}
