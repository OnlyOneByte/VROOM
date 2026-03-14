import { createId } from '@paralleldrive/cuid2';
import { logger } from '../utils/logger';
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

// Sample data for development and testing
export async function seedDatabase() {
  try {
    logger.info('Seeding database with sample data...');

    // Create a sample user
    const [sampleUser] = await db
      .insert(users)
      .values({
        email: 'demo@example.com',
        displayName: 'Demo User',
      })
      .returning();

    logger.info('Created sample user', { userId: sampleUser.id });

    // Create auth-domain provider row for demo user
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

    // Create user preferences and sync state
    await db.insert(userPreferences).values({
      userId: sampleUser.id,
    });
    await db.insert(syncState).values({
      userId: sampleUser.id,
    });

    // Create sample vehicles
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
        purchasePrice: 22000,
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
        purchasePrice: 18000,
        purchaseDate: new Date('2019-08-20'),
      })
      .returning();

    logger.info('Created sample vehicles', { vehicle1Id: vehicle1.id, vehicle2Id: vehicle2.id });

    // Create sample financing for vehicle1 (no currentBalance — computed on read)
    await db.insert(vehicleFinancing).values({
      vehicleId: vehicle1.id,
      financingType: 'loan',
      provider: 'Bank of America',
      originalAmount: 20000,
      apr: 4.5,
      termMonths: 60,
      startDate: new Date('2020-03-15'),
      paymentAmount: 372.86,
      paymentFrequency: 'monthly',
      paymentDayOfMonth: 15,
    });

    // Create sample insurance policies (v2: no terms JSON, no currentTermStart/End)
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

    // Create insurance terms with flat columns
    const termSf1Id = createId();
    const termGe1Id = createId();

    await db.insert(insuranceTerms).values([
      {
        id: termSf1Id,
        policyId: policy1.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        policyNumber: 'SF123456789',
        totalCost: 1200,
        monthlyCost: 200,
      },
      {
        id: termGe1Id,
        policyId: policy2.id,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        policyNumber: 'GE987654321',
        totalCost: 900,
        monthlyCost: 150,
      },
    ]);

    // Link terms to vehicles via junction table
    await db.insert(insuranceTermVehicles).values([
      { termId: termSf1Id, vehicleId: vehicle1.id },
      { termId: termGe1Id, vehicleId: vehicle2.id },
    ]);

    // Create sample standalone expenses (v2: volume instead of fuelAmount)
    const sampleExpenses = [
      // Fuel expenses for vehicle1
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['fuel', 'gas'],
        category: 'fuel',
        expenseAmount: 45.5,
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
        expenseAmount: 52.3,
        date: new Date('2024-01-28'),
        mileage: 25850,
        volume: 14.2,
        description: 'Chevron Gas Station',
      },
      // Maintenance expenses
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['oil-change', 'maintenance'],
        category: 'maintenance',
        expenseAmount: 75.0,
        date: new Date('2024-01-10'),
        mileage: 25400,
        description: 'Jiffy Lube - Full synthetic oil change',
      },
      {
        vehicleId: vehicle2.id,
        userId: sampleUser.id,
        tags: ['brakes', 'maintenance'],
        category: 'maintenance',
        expenseAmount: 150.0,
        date: new Date('2024-01-20'),
        mileage: 15200,
        description: 'Brake pad replacement',
      },
      // Insurance payments
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['insurance', 'monthly'],
        category: 'financial',
        expenseAmount: 200.0,
        date: new Date('2024-01-01'),
        description: 'State Farm - Monthly premium',
      },
      // Parking and tolls
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['parking'],
        category: 'misc',
        expenseAmount: 15.0,
        date: new Date('2024-01-12'),
        description: 'Downtown parking garage',
      },
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['tolls'],
        category: 'misc',
        expenseAmount: 8.5,
        date: new Date('2024-01-18'),
        description: 'Highway toll',
      },
    ];

    await db.insert(expenses).values(sampleExpenses);

    // Create sample split expense (car wash shared evenly across both vehicles)
    const splitGroupId = createId();
    const splitGroupTotal = 60.0;
    const splitDate = new Date('2024-02-01');

    await db.insert(expenses).values([
      {
        vehicleId: vehicle1.id,
        userId: sampleUser.id,
        tags: ['car-wash'],
        category: 'maintenance',
        expenseAmount: 30.0,
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
        expenseAmount: 30.0,
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
