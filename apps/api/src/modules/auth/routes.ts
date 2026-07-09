import { Router } from 'express';
import { authController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { loginSchema, googleLoginSchema, createUserSchema, updateUserSchema } from './schema.js';
import { canAccessCertApi, requiredCertApiScope } from './cert-api-access.js';
import { sendError } from '../../shared/utils/response.js';

const router = Router();

router.post(
  '/login',
  createRateLimiter(5, 15 * 60 * 1000),
  validate(loginSchema),
  authController.login,
);
router.post(
  '/google',
  createRateLimiter(10, 15 * 60 * 1000),
  validate(googleLoginSchema),
  authController.loginWithGoogle,
);
router.get('/me', authMiddleware, authController.getMe);
// Gate usado pelo nginx (auth_request) para liberar /cert-api/*. O cert-api
// recebe somente a API key interna, portanto a decisao por papel precisa
// acontecer aqui, usando URI/metodo originais que o proxy injeta.
router.get('/cert-api-access', authMiddleware, (req, res) => {
  const scope = requiredCertApiScope(
    req.header('x-cert-original-method'),
    req.header('x-cert-original-uri'),
  );

  if (!canAccessCertApi(req.user?.role, scope)) {
    return sendError(res, 'Acesso restrito para esta operação de certificações', 403);
  }

  // These headers are consumed only by Nginx's internal auth_request and
  // overwritten before proxying to cert-api. They make gateway-originated
  // certificate actions attributable to the authenticated user.
  res.set({
    'X-Cert-Actor-Id': String(req.user?.id ?? ''),
    'X-Cert-Actor-Email': req.user?.email ?? '',
    'X-Cert-Actor-Role': req.user?.role ?? '',
    'X-Cert-Required-Scope': scope,
  });
  res.status(204).send();
});

// User management (admin only)
router.get('/users', authMiddleware, adminMiddleware, authController.listUsers);
router.post(
  '/users',
  authMiddleware,
  adminMiddleware,
  validate(createUserSchema),
  authController.createUser,
);
router.put(
  '/users/:id',
  authMiddleware,
  adminMiddleware,
  validate(updateUserSchema),
  authController.updateUser,
);
router.delete('/users/:id', authMiddleware, adminMiddleware, authController.deleteUser);

export { router as authRoutes };
