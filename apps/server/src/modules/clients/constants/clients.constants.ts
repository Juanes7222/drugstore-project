// Well-known UUID for the generic consumer (CONSUMIDOR FINAL) record
// required by DIAN for sales without an identified customer.
// This record is seeded by migration 20260730000001_seed_generic_client.
export const GENERIC_CLIENT_UUID = '00000000-0000-0000-0000-000000000001';

// DIAN-standard identification for the generic consumer.
// NIT 222222222222 is the conventional identifier for end consumers
// in Colombian electronic invoicing when the buyer does not provide
// their personal identification.
export const GENERIC_CLIENT_IDENTIFICATION_TYPE = 'NIT';
export const GENERIC_CLIENT_IDENTIFICATION_NUMBER = '222222222222';
export const GENERIC_CLIENT_NAME = 'CONSUMIDOR FINAL';
