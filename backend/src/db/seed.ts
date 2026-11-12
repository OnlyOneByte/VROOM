import { createId } from '@paralleldrive/cuid2';
import { logger } from '../utils/logger';
import { dollarsToCents } from '../utils/money';
import { db } from './connection.js';
import {
  expenses,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  syncState,
  userPreferences,
  userProviders,
  users,
  vehicleFinancing,
  vehicles,
} from './schema.js';

export async function seedDatabase() {
  try {
    logger.info('Seeding database with sample data...');

    const [sampleUser] = await db
      .insert(users)
      .values({
        email: 'demo@example.com',
        displayName: 'Demo User',
      })
      .returning();

    logger.info('Created sample user', { userId: sampleUser.id });

    await db.insert(userProviders).values({
      userId: sampleUser.id,
      domain: 'auth',
      providerType: 'google',
      providerAccountId: 'demo-google-sub',
      displayName: sampleUser.displayName,
      credentials: '',
      config: { email: sampleUser.email },
      status: 'active',
    });

    await db.insert(userPreferences).values({
      userId: sampleUser.id,
    });
    await db.insert(syncState).values({
      userId: sampleUser.id,
    });

    const [vehicle1] = await db
      .insert(vehicles)
      .values({
        userId: sampleUser.id,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'ABC123',
        nickname: 'Daily Driver',
        initialMileage: 25000,
        purchasePrice: dollarsToCents(22000),
        purchaseDate: new Date('2020-03-15'),
      })
      .returning();

    const [vehicle2] = await db
      .insert(vehicles)
      .values({
        userId: sampleUser.id,
        make: 'Honda',
        model: 'Civic',
        year: 2019,
        licensePlate: 'XYZ789',
        nickname: 'Weekend Car',
        initialMileage: 15000,
        purchasePrice: dollarsToCents(18000),
        purchaseDate: new Date('2019-08-20'),
      })
      .returning();

    logger.info('Created sample vehicles', { vehicle1Id: vehicle1.id, vehicle2Id: vehicle2.id });

    await db.insert(vehicleFinancing).values({
      vehicleId: vehicle1.id,
      financingType: 'loan',
      provider: 'Bank of America',
      originalAmount: dollarsToCents(20000),
      apr: 4.5,
      termMonths: 60,
      startDate: new Date('2020-03-15'),
      paymentAmount: dollarsToCents(372.86),
      paymentFrequency: 'monthly',
      paymentDayOfMonth: 15,
    });

    const [policy1] = await db
      .insert(insurancePolicies)
      .values({
        userId: sampleUser.id,
        company: 'State Farm',
        isActive: true,
      })
      .returning();

    const [policy2] = await db
      .insert(insurancePolicies)
      .values({
        userId: sampleUser.id,
        company: 'Geico',
        isActive: true,
      })
      .returning();

    const termSf1Id = createId();
    const termGe1Id = createId();

    await db.insert(insuranceTerms).values([
      {
        id: termSf1Id,
        policyId: policy1.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        policyNumber: 'SF123456789',
        totalCost: dollarsToCents(1200),
        monthlyCost: dollarsToCents(200),
      },
      {
        id: termGe1Id,
        policyId: policy2.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        policyNumber: 'GE987654321',
        totalCost: dollarsToCents(900),
        monthlyCost: dollarsToCents(150),
      },
    ]);

    await db.insert(insuranceTermVehicles).values([
      { termId: termSf1Id, vehicleId: vehicle1.id },
      { termId: termGe1Id, vehicleId: vehicle2.id },
    ]);

    const sampleExpenses = [
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['fuel', 'gas'],
        category: 'fuel',
        expenseAmount: dollarsToCents(45.5),
        date: new Date('2024-01-15'),
        mileage: 25500,
        volume: 12.5,
        description: 'Shell Gas Station',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['fuel', 'gas'],
        category: 'fuel',
        expenseAmount: dollarsToCents(52.3),
        date: new Date('2024-01-28'),
        mileage: 25850,
        volume: 14.2,
        description: 'Chevron Gas Station',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['oil-change', 'maintenance'],
        category: 'maintenance',
        expenseAmount: dollarsToCents(75.0),
        date: new Date('2024-01-10'),
        mileage: 25400,
        description: 'Jiffy Lube - Full synthetic oil change',
      },
      {
        vehicleId: vehicle2.id,
        userId: sampleUser.id,
        tags: ['brakes', 'maintenance'],
        category: 'maintenance',
        expenseAmount: dollarsToCents(150.0),
        date: new Date('2024-01-20'),
        mileage: 15200,
        description: 'Brake pad replacement',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['insurance', 'monthly'],
        category: 'financial',
        expenseAmount: dollarsToCents(200.0),
        date: new Date('2024-01-01'),
        description: 'State Farm - Monthly premium',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['parking'],
        category: 'misc',
        expenseAmount: dollarsToCents(15.0),
        date: new Date('2024-01-12'),
        description: 'Downtown parking garage',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['tolls'],
        category: 'misc',
        expenseAmount: dollarsToCents(8.5),
        date: new Date('2024-01-18'),
        description: 'Highway toll',
      },
    ];

    await db.insert(expenses).values(sampleExpenses);

    const splitGroupId = createId();
    const splitGroupTotal = dollarsToCents(60.0);
    const splitDate = new Date('2024-02-01');

    await db.insert(expenses).values([
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['car-wash'],
        category: 'maintenance',
        expenseAmount: dollarsToCents(30.0),
        date: splitDate,
        description: 'Deluxe car wash - split',
        groupId: splitGroupId,
        groupTotal: splitGroupTotal,
        splitMethod: 'even',
      },
      {
        vehicleId: vehicle2.id,
        userId: sampleUser.id,
        tags: ['car-wash'],
        category: 'maintenance',
        expenseAmount: dollarsToCents(30.0),
        date: splitDate,
        description: 'Deluxe car wash - split',
        groupId: splitGroupId,
        groupTotal: splitGroupTotal,
        splitMethod: 'even',
      },
    ]);

    logger.info('Database seeding completed successfully', {
      standaloneExpenses: sampleExpenses.length,
      splitExpenses: 2,
    });
  } catch (error) {
    logger.error('Error seeding database', { error });
    throw error;
  }
}
