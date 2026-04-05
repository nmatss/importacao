import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express controller to catch rejections and forward them to next().
 * Eliminates repetitive try/catch in every controller.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
