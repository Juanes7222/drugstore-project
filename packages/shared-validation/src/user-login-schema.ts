import { z } from "zod";

export const UserLoginSchema = z.object({
  email: z
    .string()
    .email("Correo electronico invalido")
    .min(1, "El correo es obligatorio"),
  password: z
    .string()
    .min(8, "La contrasena debe tener al menos 8 caracteres")
    .max(128),
});
