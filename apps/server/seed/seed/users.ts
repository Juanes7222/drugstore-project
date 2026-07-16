import { prisma } from '../helpers/db';
import { hashPassword } from '../helpers/auth';
import { IDS } from '../constants/ids';

export async function seedUsers(): Promise<void> {
  console.log('Seeding users...');
  const users = [
    { id: IDS.USER_ADMIN, username: 'admin', fullName: 'Administrador del Sistema', email: 'admin@pharmacy.local', role: 'ADMIN' as const, plainPassword: 'Admin123!' },
    { id: IDS.USER_CASHIER1, username: 'cashier1', fullName: 'María Rodríguez', email: 'maria.rodriguez@pharmacy.local', role: 'CASHIER' as const, plainPassword: '1234' },
    { id: IDS.USER_CASHIER2, username: 'cashier2', fullName: 'Carlos Méndez', email: 'carlos.mendez@pharmacy.local', role: 'CASHIER' as const, plainPassword: '1234' },
    { id: IDS.USER_INVENTORY, username: 'inventory', fullName: 'Luisa García', email: 'luisa.garcia@pharmacy.local', role: 'INVENTORY_ASSISTANT' as const, plainPassword: '1234' },
    { id: IDS.USER_ACCOUNTANT, username: 'accountant', fullName: 'Pedro Contreras', email: 'pedro.contreras@pharmacy.local', role: 'ACCOUNTANT' as const, plainPassword: '1234' },
  ];

  for (const user of users) {
    const passwordHash = await hashPassword(user.plainPassword);
    await prisma.user.upsert({
      where: { id: user.id },
      update: { fullName: user.fullName, passwordHash },
      create: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        passwordHash,
        passwordAlgorithm: 'argon2id',
        createdById: null,
      },
    });
  }
  console.log('   5 users (admin, cashier1, cashier2, inventory, accountant)');
}