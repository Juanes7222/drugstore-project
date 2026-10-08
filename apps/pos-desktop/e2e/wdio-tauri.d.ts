/**
 * Ambient types for the Tauri WebdriverIO service.
 *
 * `@wdio/tauri-service` contributes a `tauri:options` capability that the stock
 * WebdriverIO types do not declare. `VendorExtensions` is the interface
 * WebdriverIO provides for exactly this — service-specific capability options
 * such as `appium:options` or `sauce:options` — so extending it is what makes
 * the e2e folder typecheckable instead of relying on an untyped config.
 */
declare global {
  namespace WebdriverIO {
    interface VendorExtensions {
      "tauri:options"?: {
        /** Path to the Tauri binary the service launches. */
        application?: string;
      };
    }
  }
}

export {};
