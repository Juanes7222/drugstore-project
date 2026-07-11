import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Guard that verifies a step-up authorization token is present and valid.
 *
 * Used on endpoints that require step-up authorization after the initial
 * authentication. The client must include the approval token in the
 * x-step-up-token header.
 *
 * Usage: @UseGuards(JwtAuthGuard, StepUpGuard)
 */
export const STEP_UP_OPERATION_KEY = 'stepUpOperation';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const operationType = this.reflector.getAllAndOverride<string>(
      STEP_UP_OPERATION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!operationType) {
      return true; // No step-up required
    }

    const request = context.switchToHttp().getRequest();
    const stepUpToken = request.headers['x-step-up-token'];

    if (!stepUpToken) {
      throw new ForbiddenException(
        'Esta operación requiere autorización adicional. ' +
        'Use el flujo de step-up para obtener un token de aprobación.',
      );
    }

    // The step-up token is stored on the request by a middleware or can be
    // verified by calling the StepUpService. For simplicity, we store the
    // verified token info in request.stepUpInfo.
    const stepUpInfo = request.stepUpInfo;
    if (!stepUpInfo || stepUpInfo.operationType !== operationType) {
      throw new ForbiddenException('Token de autorización inválido o expirado');
    }

    return true;
  }
}

export const RequireStepUp = (operationType: string) =>
  SetMetadata(STEP_UP_OPERATION_KEY, operationType);
