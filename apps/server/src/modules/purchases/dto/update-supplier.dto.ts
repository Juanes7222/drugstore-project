import { z } from "zod";
import { CreateSupplierSchema } from "./create-supplier.dto";

export const UpdateSupplierSchema = CreateSupplierSchema.partial();

export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;
