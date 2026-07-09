interface Identifiable {
  id: string;
}

/**
 * Generic upsert for seed data with an ID.
 * Calls `prismaDelegate.upsert` for each item, using `where: { id }` and merging `update` and `create`.
 * `update` defaults to the whole item, and `create` uses the item directly.
 */
export async function seedMany<T extends Identifiable>(
  prismaDelegate: { upsert: (args: { where: { id: string }; update: Partial<T>; create: T }) => Promise<unknown> },
  items: T[],
  options?: {
    update?: (item: T) => Partial<T>;
    create?: (item: T) => T;
  }
): Promise<void> {
  for (const item of items) {
    const updateData = options?.update ? options.update(item) : item;
    const createData = options?.create ? options.create(item) : item;
    await prismaDelegate.upsert({
      where: { id: item.id },
      update: updateData,
      create: createData,
    });
  }
}