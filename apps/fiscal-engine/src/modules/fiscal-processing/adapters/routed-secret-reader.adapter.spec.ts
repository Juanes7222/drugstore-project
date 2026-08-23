// The adapter's import chain pulls in PrismaService, which value-imports the
// generated Prisma client — keep it out of the module graph (same pattern as
// db-certificate-secret-reader.adapter.spec.ts).
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { RoutedSecretReaderAdapter } from './routed-secret-reader.adapter';
import type { SecretReaderPort } from '../ports/secret-reader.port';

describe('RoutedSecretReaderAdapter', () => {
  let dbReader: { readSecret: jest.Mock };
  let fileReader: { readSecret: jest.Mock };
  let adapter: RoutedSecretReaderAdapter;

  beforeEach(() => {
    dbReader = { readSecret: jest.fn() };
    fileReader = { readSecret: jest.fn() };
    adapter = new RoutedSecretReaderAdapter(
      dbReader as unknown as SecretReaderPort,
      fileReader as unknown as SecretReaderPort,
    );
  });

  it('routes file: references to the file-system reader (server-side PROVIDER credentials)', async () => {
    await adapter.readSecret('sub-1', 'file:tech-provider.json');

    expect(fileReader.readSecret).toHaveBeenCalledWith(
      'sub-1',
      'file:tech-provider.json',
    );
    expect(dbReader.readSecret).not.toHaveBeenCalled();
  });

  it('routes non-file references to the db certificate reader (tenant DIAN_DIRECT certificate)', async () => {
    await adapter.readSecret('sub-1', '');

    expect(dbReader.readSecret).toHaveBeenCalledWith('sub-1', '');
    expect(fileReader.readSecret).not.toHaveBeenCalled();
  });
});