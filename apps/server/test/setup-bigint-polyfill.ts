// Mirrors the BigInt JSON-serialization fix applied in src/main.ts. The e2e
// specs mount AppModule directly (no bootstrap()), so responses containing
// Prisma BigInt columns (Sale.localNumber) would otherwise throw
// "Do not know how to serialize a BigInt" in express's res.json().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
