import { z } from "zod";

export const UserLoginSchema = z.object({
  username: z
    .string()
    .min(1, "El usuario es obligatorio")
    .max(100),
  password: z
    .string()
    .min(8, "La contrasena debe tener al menos 8 caracteres")
    .max(128),
});
