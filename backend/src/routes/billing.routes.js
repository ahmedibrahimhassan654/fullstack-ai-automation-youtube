import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

// Webhook must be reachable by Stripe without auth.
router.post('/webhook', asyncHandler(async (req, res) => {
  res.status(501).json({ success: false, message: 'Billing: webhook not implemented yet' });
}));

// Other billing routes require an authenticated user.
router.use(protect);

router.get('/plans', asyncHandler(async (req, res) => {
  res.status(501).json({ success: false, message: 'Billing: plans not implemented yet' });
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  res.status(501).json({ success: false, message: 'Billing: checkout not implemented yet' });
}));

router.get('/subscription', asyncHandler(async (req, res) => {
  res.status(501).json({ success: false, message: 'Billing: subscription status not implemented yet' });
}));

export default router;
