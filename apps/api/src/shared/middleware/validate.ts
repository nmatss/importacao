import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        error: 'Dados inválidos',
        details: errors,
      });
    }

    if (source === 'body') {
      req.body = result.data;
    } else if (source === 'query') {
      req.query = result.data as Record<string, string>;
    } else if (source === 'params') {
      req.params = result.data as Record<string, string>;
    }

    next();
  };
}
