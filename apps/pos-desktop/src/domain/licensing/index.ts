/**
 * Licensing module for the POS desktop app.
 *
 * Handles workstation activation, license check-ins, and soft-lock enforcement.
 * The license service is the single point of consultation for all write operations.
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
