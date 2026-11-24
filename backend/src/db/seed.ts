import { createId } from '@paralleldrive/cuid2';
import { createTermExpenses } from '../api/insurance/hooks';
import { assignServerRole } from '../permissions/grants';
import { logger } from '../utils/logger';
import { dollarsToCents } from '../utils/money';
import { db } from './connection.js';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  type NewExpense,
  type NewTrip,
  syncState,
  trips,
  userPreferences,
  userProviders,
  users,
  type VehicleFinancing,
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

function tripAroundFillUp(
  pattern: DrivingPattern,
  days: number,
  miles: number,
  purpose: 'business' | 'personal',
  startLocation: string,
  endLocation: string
): NewTrip {
  const startOdometer = mileageOn(pattern, days) - Math.floor(miles / 2);
  return {
    vehicleId: pattern.vehicleId,
    userId: pattern.userId,
    startOdometer,
    endOdometer: startOdometer + miles,
    purpose,
    tripDate: daysAgo(days),
    startLocation,
    endLocation,
  };
}

function loanPayments(loan: VehicleFinancing, pattern: DrivingPattern): NewExpense[] {
  const rows: NewExpense[] = [];
  const now = new Date();
  const start = loan.startDate;
  const dayOfMonth = loan.paymentDayOfMonth ?? start.getDate();
  for (let month = 1; ; month++) {
    const due = new Date(start.getFullYear(), start.getMonth() + month, dayOfMonth, 12);
    if (due > now) break;
    rows.push({
      vehicleId: pattern.vehicleId,
      userId: pattern.userId,
      tags: ['loan'],
      category: 'financial',
      expenseAmount: loan.paymentAmount,
      date: due,
      description: 'Loan payment',
      sourceType: 'financing',
      sourceId: loan.id,
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

    assignServerRole(db, sampleUser.id, 'member');
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

    await seedGarage(sampleUser.id);
  } catch (error) {
    logger.error('Error seeding database', { error });
    throw error;
  }
}

export async function seedGarage(userId: string) {
  try {
    await db.insert(userPreferences).values({
      userId,
    });
    await db.insert(syncState).values({
      userId,
    });

    const [vehicle1] = await db
      .insert(vehicles)
      .values({
        userId,
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
        userId,
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
        userId,
        company: 'State Farm',
        isActive: true,
      })
      .returning();

    const [policy2] = await db
      .insert(insurancePolicies)
      .values({
        userId,
        company: 'Geico',
        isActive: true,
      })
      .returning();

    const terms = [
      {
        id: createId(),
        policyId: policy1.id,
        startDate: daysAgo(120),
        endDate: daysAgo(-62),
        policyNumber: 'SF123456789',
        totalCost: dollarsToCents(1200),
        monthlyCost: dollarsToCents(200),
        vehicleId: vehicle1.id,
      },
      {
        id: createId(),
        policyId: policy2.id,
        startDate: daysAgo(120),
        endDate: daysAgo(-62),
        policyNumber: 'GE987654321',
        totalCost: dollarsToCents(900),
        monthlyCost: dollarsToCents(150),
        vehicleId: vehicle2.id,
      },
    ];

    for (const { vehicleId, ...term } of terms) {
      await db.insert(insuranceTerms).values(term);
      await db.insert(insuranceTermVehicles).values({ termId: term.id, vehicleId });
      await createTermExpenses({
        termId: term.id,
        vehicleIds: [vehicleId],
        totalCost: term.totalCost,
        monthlyCost: term.monthlyCost,
        startDate: term.startDate,
        endDate: term.endDate,
        policyNumber: term.policyNumber,
        userId,
      });
    }

    const camry: DrivingPattern = {
      vehicleId: vehicle1.id,
      userId,
      mileageAYearAgo: 29000,
      milesPerDay: 32,
    };
    const civic: DrivingPattern = {
      vehicleId: vehicle2.id,
      userId,
      mileageAYearAgo: 24000,
      milesPerDay: 14,
    };

    const sampleExpenses: NewExpense[] = [
      ...fillUps(camry, 10, 31, ['Shell', 'Chevron', 'Costco Gas']),
      ...fillUps(civic, 21, 35, ['Chevron', 'Arco']),
      plainExpense(camry, 340, 75, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      plainExpense(camry, 220, 75, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      plainExpense(camry, 100, 79, 'maintenance', ['oil-change'], 'Full synthetic oil change'),
      plainExpense(camry, 160, 640, 'maintenance', ['tires'], 'Four new all-season tires'),
      plainExpense(camry, 45, 35, 'maintenance', ['tire-rotation'], 'Tire rotation'),
      plainExpense(civic, 250, 150, 'maintenance', ['brakes'], 'Brake pad replacement'),
      plainExpense(civic, 70, 69, 'maintenance', ['oil-change'], 'Oil change'),
      plainExpense(camry, 300, 185, 'regulatory', ['registration'], 'Annual registration'),
      plainExpense(civic, 200, 160, 'regulatory', ['registration'], 'Annual registration'),
      plainExpense(camry, 130, 420, 'enhancement', ['dash-cam'], 'Dash cam install'),
      plainExpense(camry, 25, 15, 'misc', ['parking'], 'Downtown parking garage'),
      plainExpense(camry, 18, 8.5, 'misc', ['tolls'], 'Highway toll'),
      plainExpense(civic, 9, 12, 'misc', ['parking'], 'Airport parking'),
      ...loanPayments(loan, camry),
    ];

    await db.insert(expenses).values(sampleExpenses);

    await db
      .insert(trips)
      .values([
        tripAroundFillUp(camry, 80, 248, 'business', 'San Jose', 'Tejon Ranch'),
        tripAroundFillUp(civic, 45, 412, 'personal', 'Home', 'Lake Tahoe'),
        tripAroundFillUp(camry, 20, 36, 'business', 'Office', 'Client site'),
        tripAroundFillUp(camry, 40, 142, 'personal', 'Home', 'Monterey'),
      ]);

    await db.insert(insuranceClaims).values({
      policyId: policy1.id,
      termId: terms[0].id,
      vehicleId: vehicle1.id,
      claimDate: daysAgo(105),
      claimType: 'other',
      description: 'Windshield chip repair',
      status: 'settled',
      payoutAmount: dollarsToCents(120),
      faultDesignation: 'not_at_fault',
    });

    const splitGroupId = createId();
    const splitGroupTotal = dollarsToCents(60.0);
    const splitDate = daysAgo(12);

    await db.insert(expenses).values([
      {
        vehicleId: vehicle1.id,
        userId,
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
        userId,
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
      trips: 4,
      claims: 1,
    });
  } catch (error) {
    logger.error('Error seeding database', { error });
    throw error;
  }
}
