import { prisma } from '../helpers/db';
import { seedMany } from '../helpers/upsert';
import { IDS } from '../constants/ids';

interface SeedClient {
  id: string;
  identificationType: 'CC' | 'NIT';
  identificationNumber: string;
  fullName: string;
  email: string | null;
  phone: string;
  classificationId: string;
}

function buildClients(): SeedClient[] {
  return [
    {
      id: IDS.CLIENT_JUAN,
      identificationType: 'CC',
      identificationNumber: '1234567890',
      fullName: 'Juan Pérez',
      email: 'juan.perez@email.com',
      phone: '3001112233',
      classificationId: IDS.CLASS_FRECUENTE,
    },
    {
      id: IDS.CLIENT_MARIA,
      identificationType: 'CC',
      identificationNumber: '2345678901',
      fullName: 'María González',
      email: 'maria.gonzalez@email.com',
      phone: '3102223344',
      classificationId: IDS.CLASS_PARTICULAR,
    },
    {
      id: IDS.CLIENT_CARLOS,
      identificationType: 'CC',
      identificationNumber: '3456789012',
      fullName: 'Carlos Martínez',
      email: null,
      phone: '3203334455',
      classificationId: IDS.CLASS_PARTICULAR,
    },
    {
      id: IDS.CLIENT_ANDREA,
      identificationType: 'CC',
      identificationNumber: '4567890123',
      fullName: 'Andrea López',
      email: 'andrea.lopez@email.com',
      phone: '3114445566',
      classificationId: IDS.CLASS_FRECUENTE,
    },
    {
      id: IDS.CLIENT_PEDRO,
      identificationType: 'CC',
      identificationNumber: '5678901234',
      fullName: 'Pedro Ramírez',
      email: null,
      phone: '3225556677',
      classificationId: IDS.CLASS_PARTICULAR,
    },
    {
      id: IDS.CLIENT_LAURA,
      identificationType: 'CC',
      identificationNumber: '6789012345',
      fullName: 'Laura Díaz',
      email: 'laura.diaz@email.com',
      phone: '3136667788',
      classificationId: IDS.CLASS_FRECUENTE,
    },
    {
      id: IDS.CLIENT_DIEGO,
      identificationType: 'CC',
      identificationNumber: '7890123456',
      fullName: 'Diego Torres',
      email: null,
      phone: '3237778899',
      classificationId: IDS.CLASS_PARTICULAR,
    },
    {
      id: IDS.CLIENT_SOFIA,
      identificationType: 'CC',
      identificationNumber: '8901234567',
      fullName: 'Sofía Hernández',
      email: 'sofia.h@email.com',
      phone: '3148889900',
      classificationId: IDS.CLASS_FRECUENTE,
    },
    {
      id: IDS.CLIENT_CLINICA_SAN_JOSE,
      identificationType: 'NIT',
      identificationNumber: '900555666-1',
      fullName: 'Clínica San José S.A.S.',
      email: 'compras@clinicasanjose.com',
      phone: '6014445566',
      classificationId: IDS.CLASS_INSTITUCIONAL,
    },
    {
      id: IDS.CLIENT_HOGAR_GERIATRICO,
      identificationType: 'NIT',
      identificationNumber: '801222333-4',
      fullName: 'Hogar Geriátrico Santa Ana',
      email: 'admin@hogarsantaana.org',
      phone: '6045556677',
      classificationId: IDS.CLASS_INSTITUCIONAL,
    },
  ];
}

function createClientData(client: SeedClient) {
  return {
    ...client,
    createdById: IDS.USER_ADMIN,
    municipality: 'Bogotá D.C.',
    department: 'Cundinamarca',
  };
}

export async function seedClients(): Promise<void> {
  console.log('Seeding clients...');
  const clients = buildClients();
  await seedMany(prisma.client, clients, {
    create: createClientData,
  });
  console.log('   10 clients (8 individuals, 2 institutional)');
}