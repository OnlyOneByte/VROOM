import { createId } from '@paralleldrive/cuid2';
import { logger } from '../utils/logger';
import { dollarsToCents } from '../utils/money';
import { db } from './connection.js';
import {
  expenses,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  type NewExpense,
  syncState,
  userPreferences,
  userProviders,
  users,
  vehicleFinancing,
  vehicles,
} from './schema.js';

function daysAgo(days: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12);
}

interface DrivingPattern {
  vehicleId: string;
  userId: string;
  mileageAYearAgo: number;
  milesPerDay: number;
}

function mileageOn(pattern: DrivingPattern, days: number): number {
  return Math.round(pattern.mileageAYearAgo + pattern.milesPerDay * (365 - days));
}

function fillUps(
  pattern: DrivingPattern,
  everyDays: number,
  mpg: number,
  stations: string[]
): NewExpense[] {
  const rows: NewExpense[] = [];
  for (let i = 0, days = 360; days >= 2; i++, days -= everyDays) {
    const efficiency = mpg + (((i * 7) % 5) - 2) * 0.6;
    const volume = Math.round(((pattern.milesPerDay * everyDays) / efficiency) * 100) / 100;
    const pricePerGallon = 3.45 + ((i * 3) % 7) * 0.06;
    rows.push({
      vehicleId: pattern.vehicleId,
      userId: pattern.userId,
      tags: ['fuel'],
      category: 'fuel',
      expenseAmount: dollarsToCents(volume * pricePerGallon),
      date: daysAgo(days),
      mileage: mileageOn(pattern, days),
      volume,
      description: stations[i % stations.length],
    });
  }
  return rows;
}

function serviceVisit(
  pattern: DrivingPattern,
  days: number,
  dollars: number,
  category: string,
  tags: string[],
  description: string
): NewExpense {
  return {
    vehicleId: pattern.vehicleId,
    userId: pattern.userId,
    tags,
    category,
    expenseAmount: dollarsToCents(dollars),
    date: daysAgo(days),
    mileage: mileageOn(pattern, days),
    description,
  };
}

function plainExpense(
  pattern: DrivingPattern,
  days: number,
  dollars: number,
  category: string,
  tags: string[],
  description: string
): NewExpense {
  return {
    vehicleId: pattern.vehicleId,
    userId: pattern.userId,
    tags,
    category,
    expenseAmount: dollarsToCents(dollars),
    date: daysAgo(days),
    description,
  };
}

function loanPayments(
  financingId: string,
  pattern: DrivingPattern,
  start: Date,
  dollars: number
): NewExpense[] {
  const rows: NewExpense[] = [];
  const today = daysAgo(0);
  for (let month = 1; ; month++) {
    const due = new Date(start.getFullYear(), start.getMonth() + month, 15, 12);
    if (due > today) break;
    rows.push({
      vehicleId: pattern.vehicleId,
      userId: pattern.userId,
      tags: ['loan'],
      category: 'financial',
      expenseAmount: dollarsToCents(dollars),
      date: due,
      description: 'Loan payment',
      sourceType: 'financing',
      sourceId: financingId,
    });
  }
  return rows;
}

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
        initialMileage: 18000,
        purchasePrice: dollarsToCents(22000),
        purchaseDate: daysAgo(730),
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
        initialMileage: 9000,
        purchasePrice: dollarsToCents(18000),
        purchaseDate: daysAgo(1400),
      })
      .returning();

    logger.info('Created sample vehicles', { vehicle1Id: vehicle1.id, vehicle2Id: vehicle2.id });

    const [loan] = await db
      .insert(vehicleFinancing)
      .values({
        vehicleId: vehicle1.id,
        financingType: 'loan',
        provider: 'Bank of America',
        originalAmount: dollarsToCents(20000),
        apr: 4.5,
        termMonths: 60,
        startDate: daysAgo(730),
        paymentAmount: dollarsToCents(372.86),
        paymentFrequency: 'monthly',
        paymentDayOfMonth: 15,
      })
      .returning();

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
        startDate: daysAgo(120),
        endDate: daysAgo(-62),
        policyNumber: 'SF123456789',
        totalCost: dollarsToCents(1200),
        monthlyCost: dollarsToCents(200),
      },
      {
        id: termGe1Id,
        policyId: policy2.id,
        startDate: daysAgo(120),
        endDate: daysAgo(-62),
        policyNumber: 'GE987654321',
        totalCost: dollarsToCents(900),
        monthlyCost: dollarsToCents(150),
      },
    ]);

    await db.insert(insuranceTermVehicles).values([
      { termId: termSf1Id, vehicleId: vehicle1.id },
      { termId: termGe1Id, vehicleId: vehicle2.id },
    ]);

    const camry: DrivingPattern = {
      vehicleId: vehicle1.id,
      userId: sampleUser.id,
      mileageAYearAgo: 29000,
      milesPerDay: 32,
    };
    const civic: DrivingPattern = {
      vehicleId: vehicle2.id,
      userId: sampleUser.id,
      mileageAYearAgo: 24000,
      milesPerDay: 14,
    };

    const sampleExpenses: NewExpense[] = [
      ...fillUps(camry, 10, 31, ['Shell', 'Chevron', 'Costco Gas']),
      ...fillUps(civic, 21, 35, ['Chevron', 'Arco']),
      serviceVisit(camry, 340, 75, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      serviceVisit(camry, 220, 75, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      serviceVisit(camry, 100, 79, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      serviceVisit(camry, 160, 640, 'maintenance', ['tires'], 'Four new all-season tires'),
      serviceVisit(camry, 45, 35, 'maintenance', ['tire-rotation'], 'Tire rotation'),
      serviceVisit(civic, 250, 150, 'maintenance', ['brakes'], 'Brake pad replacement'),
      serviceVisit(civic, 70, 69, 'maintenance', ['oil-change'], 'Oil change'),
      plainExpense(camry, 300, 185, 'regulatory', ['registration'], 'Annual registration'),
      plainExpense(civic, 200, 160, 'regulatory', ['registration'], 'Annual registration'),
      plainExpense(camry, 130, 420, 'enhancement', ['dash-cam'], 'Dash cam install'),
      plainExpense(camry, 25, 15, 'misc', ['parking'], 'Downtown parking garage'),
      plainExpense(camry, 18, 8.5, 'misc', ['tolls'], 'Highway toll'),
      plainExpense(civic, 9, 12, 'misc', ['parking'], 'Airport parking'),
      ...loanPayments(loan.id, camry, daysAgo(730), 372.86),
      ...[105, 75, 45, 15].flatMap((days) => [
        plainExpense(camry, days, 200, 'financial', ['insurance'], 'State Farm - Monthly premium'),
        plainExpense(civic, days, 150, 'financial', ['insurance'], 'Geico - Monthly premium'),
      ]),
    ];

    await db.insert(expenses).values(sampleExpenses);

    const splitGroupId = createId();
    const splitGroupTotal = dollarsToCents(60.0);
    const splitDate = daysAgo(12);

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
