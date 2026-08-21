/**
 * Local import definitions registry — one definition per importable entity.
 */

import type { PrismaClient } from "@pharmacy/database/local";
import type { ProductService } from "../../catalog/product.service";
import type { ClientsService } from "../../clients/clients.service";
import type { ImportEntityKey } from "../import.types";
import type { ImportDefinition } from "./import-definition";
import { ProductImportDefinition } from "./product-import.definition";
import { ClientImportDefinition } from "./client-import.definition";

export type {
  ImportDefinition,
  ImportRowWithNumber,
} from "./import-definition";
export { ProductImportDefinition } from "./product-import.definition";
export { ClientImportDefinition } from "./client-import.definition";

/** Build the definition registry for the given Prisma client. */
export function createImportDefinitions(
  prisma: PrismaClient,
  productService: ProductService,
  clientsService: ClientsService,
): Record<ImportEntityKey, ImportDefinition<unknown, { id: string }>> {
  return {
    products: new ProductImportDefinition(prisma, productService),
    clients: new ClientImportDefinition(prisma, clientsService),
  };
}
