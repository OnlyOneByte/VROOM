import { logger } from '../utils/logger';
import { db } from './connection.js';
import {
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
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
        provider: 'google',
        providerId: 'demo-provider-id',
      })
      .returning();

    logger.info('Created sample user', { userId: sampleUser.id });

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

    // Create sample financing for vehicle1
    await db.insert(vehicleFinancing).values({
      vehicleId: vehicle1.id,
      financingType: 'loan',
      provider: 'Bank of America',
      originalAmount: 20000,
      currentBalance: 15000,
      apr: 4.5,
      termMonths: 60,
      startDate: new Date('2020-03-15'),
      paymentAmount: 372.86,
      paymentFrequency: 'monthly',
      paymentDayOfMonth: 15,
    });

    // Create sample insurance policies with new multi-term schema
    const [policy1] = await db
      .insert(insurancePolicies)
      .values({
        company: 'State Farm',
        isActive: true,
        currentTermStart: new Date('2024-01-01'),
        currentTermEnd: new Date('2024-06-30'),
        terms: [
          {
            id: 'term-sf-1',
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            policyDetails: { policyNumber: 'SF123456789' },
            financeDetails: { totalCost: 1200, monthlyCost: 200 },
          },
        ],
      })
      .returning();

    const [policy2] = await db
      .insert(insurancePolicies)
      .values({
        company: 'Geico',
        isActive: true,
        currentTermStart: new Date('2024-01-01'),
        currentTermEnd: new Date('2024-06-30'),
        terms: [
          {
            id: 'term-ge-1',
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            policyDetails: { policyNumber: 'GE987654321' },
            financeDetails: { totalCost: 900, monthlyCost: 150 },
          },
        ],
      })
      .returning();

    // Link policies to vehicles via junction table
    await db.insert(insurancePolicyVehicles).values([
      { policyId: policy1.id, vehicleId: vehicle1.id },
      { policyId: policy2.id, vehicleId: vehicle2.id },
    ]);

    // Create sample expenses
    const sampleExpenses = [
      // Fuel expenses for vehicle1
      {
        vehicleId: vehicle1.id,
        tags: ['fuel', 'gas'],
        category: 'fuel',
        expenseAmount: 45.5,
        date: new Date('2024-01-15'),
        mileage: 25500,
        fuelAmount: 12.5,
        description: 'Shell Gas Station',
      },
      {
        vehicleId: vehicle1.id,
        tags: ['fuel', 'gas'],
        category: 'fuel',
        expenseAmount: 52.3,
        date: new Date('2024-01-28'),
        mileage: 25850,
        fuelAmount: 14.2,
        description: 'Chevron Gas Station',
      },
      // Maintenance expenses
      {
        vehicleId: vehicle1.id,
        tags: ['oil-change', 'maintenance'],
        category: 'maintenance',
        expenseAmount: 75.0,
        date: new Date('2024-01-10'),
        mileage: 25400,
        description: 'Jiffy Lube - Full synthetic oil change',
      },
      {
        vehicleId: vehicle2.id,
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
        tags: ['insurance', 'monthly'],
        category: 'financial',
        expenseAmount: 200.0,
        date: new Date('2024-01-01'),
        description: 'State Farm - Monthly premium',
      },
      // Parking and tolls
      {
        vehicleId: vehicle1.id,
        tags: ['parking'],
        category: 'misc',
        expenseAmount: 15.0,
        date: new Date('2024-01-12'),
        description: 'Downtown parking garage',
      },
      {
        vehicleId: vehicle1.id,
        tags: ['tolls'],
        category: 'misc',
        expenseAmount: 8.5,
        date: new Date('2024-01-18'),
        description: 'Highway toll',
      },
    ];

    await db.insert(expenses).values(sampleExpenses);

    logger.info('Database seeding completed successfully', { expenseCount: sampleExpenses.length });
  } catch (error) {
    logger.error('Error seeding database', { error });
    throw error;
  }
}

// Function to clear all data (useful for testing)
export async function clearDatabase() {
  try {
    logger.info('Clearing database...');

    // Delete in reverse order of dependencies
    await db.delete(expenses);
    await db.delete(insurancePolicyVehicles);
    await db.delete(insurancePolicies);
    await db.delete(vehicleFinancing);
    await db.delete(vehicles);
    await db.delete(users);

    logger.info('Database cleared successfully');
  } catch (error) {
    logger.error('Error clearing database', { error });
    throw error;
  }
}
