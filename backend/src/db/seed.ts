import { db } from './connection.js';
import { expenses, insurancePolicies, users, vehicleLoans, vehicles } from './schema.js';
import type { ExpenseType } from './types.js';
import { getCategoryForExpenseType } from './types.js';

// Sample data for development and testing
export async function seedDatabase() {
  try {
    console.log('Seeding database with sample data...');

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

    console.log('Created sample user:', sampleUser.id);

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

    console.log('Created sample vehicles:', vehicle1.id, vehicle2.id);

    // Create sample loan for vehicle1
    await db.insert(vehicleLoans).values({
      vehicleId: vehicle1.id,
      lender: 'Bank of America',
      originalAmount: 20000,
      currentBalance: 15000,
      apr: 4.5,
      termMonths: 60,
      startDate: new Date('2020-03-15'),
      paymentAmount: 372.86,
      paymentFrequency: 'monthly',
      paymentDayOfMonth: 15,
    });

    // Create sample insurance policies
    await db.insert(insurancePolicies).values([
      {
        vehicleId: vehicle1.id,
        company: 'State Farm',
        policyNumber: 'SF123456789',
        totalCost: 1200,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200, // 1200 / 6
      },
      {
        vehicleId: vehicle2.id,
        company: 'Geico',
        policyNumber: 'GE987654321',
        totalCost: 900,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 150, // 900 / 6
      },
    ]);

    // Create sample expenses
    const sampleExpenses = [
      // Fuel expenses for vehicle1
      {
        vehicleId: vehicle1.id,
        type: 'fuel' as ExpenseType,
        category: getCategoryForExpenseType('fuel'),
        amount: 45.5,
        date: new Date('2024-01-15'),
        mileage: 25500,
        gallons: 12.5,
        description: 'Shell Gas Station',
      },
      {
        vehicleId: vehicle1.id,
        type: 'fuel' as ExpenseType,
        category: getCategoryForExpenseType('fuel'),
        amount: 52.3,
        date: new Date('2024-01-28'),
        mileage: 25850,
        gallons: 14.2,
        description: 'Chevron Gas Station',
      },
      // Maintenance expenses
      {
        vehicleId: vehicle1.id,
        type: 'oil-change' as ExpenseType,
        category: getCategoryForExpenseType('oil-change'),
        amount: 75.0,
        date: new Date('2024-01-10'),
        mileage: 25400,
        description: 'Jiffy Lube - Full synthetic oil change',
      },
      {
        vehicleId: vehicle2.id,
        type: 'maintenance' as ExpenseType,
        category: getCategoryForExpenseType('maintenance'),
        amount: 150.0,
        date: new Date('2024-01-20'),
        mileage: 15200,
        description: 'Brake pad replacement',
      },
      // Insurance payments
      {
        vehicleId: vehicle1.id,
        type: 'insurance' as ExpenseType,
        category: getCategoryForExpenseType('insurance'),
        amount: 200.0,
        date: new Date('2024-01-01'),
        description: 'State Farm - Monthly premium',
      },
      // Parking and tolls
      {
        vehicleId: vehicle1.id,
        type: 'parking' as ExpenseType,
        category: getCategoryForExpenseType('parking'),
        amount: 15.0,
        date: new Date('2024-01-12'),
        description: 'Downtown parking garage',
      },
      {
        vehicleId: vehicle1.id,
        type: 'tolls' as ExpenseType,
        category: getCategoryForExpenseType('tolls'),
        amount: 8.5,
        date: new Date('2024-01-18'),
        description: 'Highway toll',
      },
    ];

    await db.insert(expenses).values(sampleExpenses);

    console.log('Database seeding completed successfully');
    console.log(`Created ${sampleExpenses.length} sample expenses`);
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

// Function to clear all data (useful for testing)
export async function clearDatabase() {
  try {
    console.log('Clearing database...');

    // Delete in reverse order of dependencies
    await db.delete(expenses);
    await db.delete(insurancePolicies);
    await db.delete(vehicleLoans);
    await db.delete(vehicles);
    await db.delete(users);

    console.log('Database cleared successfully');
  } catch (error) {
    console.error('Error clearing database:', error);
    throw error;
  }
}
