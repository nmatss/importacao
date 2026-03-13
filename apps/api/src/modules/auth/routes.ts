import { Router } from 'express';
import { authController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { loginSchema, createUserSchema, updateUserSchema } from './schema.js';

const router = Router();

router.post('/login', createRateLimiter(5, 15 * 60 * 1000), validate(loginSchema), authController.login);
router.post('/google', createRateLimiter(10, 15 * 60 * 1000), authController.loginWithGoogle);
router.get('/me', authMiddleware, authController.getMe);

// User management (admin only)
router.get('/users', authMiddleware, adminMiddleware, authController.listUsers);
router.post('/users', authMiddleware, adminMiddleware, validate(createUserSchema), authController.createUser);
router.put('/users/:id', authMiddleware, adminMiddleware, validate(updateUserSchema), authController.updateUser);
router.delete('/users/:id', authMiddleware, adminMiddleware, authController.deleteUser);

export { router as authRoutes };
