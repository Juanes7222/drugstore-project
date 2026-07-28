/**
 * Licensing module for the POS desktop app.
 *
 * Handles workstation activation, license check-ins, soft-lock enforcement,
 * and Wompi-powered subscription checkout. The license service is the single
 * point of consultation for all write operations.
 */
export { createLicenseService, type LicenseService, type LicenseGuard } from './license.service';
export { useLicenseStore } from './license.store';
export {
  createLicenseCheckInScheduler,
  LicenseCheckInScheduler,
} from './license-check-in-scheduler';
export {
  LicenseInvalidException,
  ActivationFailedException,
  CheckInFailedException,
  AlreadyActivatedException,
  TokenVerificationFailedException,
} from './exceptions';
export {
  createWompiCheckoutService,
  CheckoutError,
  type WompiCheckoutService,
  type CheckoutPlan,
  type CreateCheckoutSessionRequest,
  type CheckoutSession,
  type SessionStatus,
} from './wompi-checkout.service';
