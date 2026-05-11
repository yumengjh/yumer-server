import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../errors/error-codes';

export class BusinessException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    details?: unknown,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        success: false,
        error: {
          code,
          message,
          ...(details != null && { details }),
        },
      },
      statusCode,
    );
  }
}
