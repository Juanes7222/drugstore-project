interface Identifiable {
  id: string;
}

/**
 * Generic upsert for seed data with an ID.
 * Calls `prismaDelegate.upsert` for each item, using `where: { id }` and merging `update` and `create`.
 * `update` defaults to the whole item, and `create` uses the item directly.
 * When `subscriptionId` is provided it is stamped into `create` —
 * tenant-scoped models require it (NOT NULL + RLS). Updates target an
 * already-stamped row by id, so they need no tenant value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// The generated Prisma delegate upsert signatures are too specific to be
// matched structurally; a loose args type keeps this seed helper generic.
type SeedUpsertArgs = { where: { id: string }; update: any; create: any };

export async function seedMany<T extends Identifiable>(
  prismaDelegate: { upsert: (args: SeedUpsertArgs) => Promise<unknown> },
  items: T[],
  options?: {
    update?: (item: T) => Partial<T>;
    create?: (item: T) => T;
    subscriptionId?: string;
  }
): Promise<void> {
  for (const item of items) {
    const updateData = options?.update ? options.update(item) : item;
    let createData = options?.create ? options.create(item) : item;
    if (options?.subscriptionId) {
      createData = { ...createData, subscriptionId: options.subscriptionId };
    }
    await prismaDelegate.upsert({
      where: { id: item.id },
      update: updateData,
      create: createData,
    });
  }
}