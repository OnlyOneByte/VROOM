#!/usr/bin/env bun

import { databaseService } from '../src/lib/core/database.js';
import {
  userRepository,
  vehicleRepository,
  expenseRepository,
  vehicleFinancingRepository,
  insurancePolicyRepository,
} from '../src/lib/repositories/index.js';

async function testRepositories() {
  try {
    console.log('🧪 Testing repository implementations...');

    // Test database health
    const health = await databaseService.healthCheck();
    console.log('Database health:', health);

    if (!health.healthy) {
      throw new Error('Database is not healthy');
    }

    // Use direct repository exports
    const userRepo = userRepository;
    const vehicleRepo = vehicleRepository;
    const expenseRepo = expenseRepository;
    const loanRepo = vehicleFinancingRepository;
    const insuranceRepo = insurancePolicyRepository;

    // Test user operations
    console.log('\n👤 Testing User Repository...');
    const testUser = await userRepo.create({
      email: 'test@example.com',
      displayName: 'Test User',
      provider: 'google',
      providerId: 'test-provider-123',
    });
    console.log('Created user:', testUser.id);

    const foundUser = await userRepo.findByEmail('test@example.com');
    console.log('Found user by email:', foundUser?.id);

    // Test vehicle operations
    console.log('\n🚗 Testing Vehicle Repository...');
    const testVehicle = await vehicleRepo.create({
      userId: testUser.id,
      make: 'Test',
      model: 'Car',
      year: 2023,
      licensePlate: 'TEST123',
      nickname: 'Test Vehicle',
    });
    console.log('Created vehicle:', testVehicle.id);

    const userVehicles = await vehicleRepo.findByUserId(testUser.id);
    console.log('User vehicles count:', userVehicles.length);

    // Test expense operations
    console.log('\n💰 Testing Expense Repository...');
    const testExpense = await expenseRepo.create({
      vehicleId: testVehicle.id,
      tags: ['fuel', 'test'],
      category: 'fuel',
      expenseAmount: 50.0,
      fuelAmount: 12.5,
      fuelType: 'regular',
      date: new Date(),
      description: 'Test fuel expense',
    });
    console.log('Created expense:', testExpense.id);

    const vehicleExpenses = await expenseRepo.findByVehicleId(testVehicle.id);
    console.log('Vehicle expenses count:', vehicleExpenses.length);

    const fuelExpenses = await expenseRepo.findFuelExpenses(testVehicle.id);
    console.log('Fuel expenses count:', fuelExpenses.length);

    // Test loan operations
    console.log('\n🏦 Testing Loan Repository...');
    const testLoan = await loanRepo.create({
      vehicleId: testVehicle.id,
      provider: 'Test Bank',
      financingType: 'loan',
      originalAmount: 20000,
      currentBalance: 15000,
      apr: 4.5,
      termMonths: 60,
      startDate: new Date(),
      paymentAmount: 372.86,
      paymentFrequency: 'monthly',
      paymentDayOfMonth: 15,
    });
    console.log('Created loan:', testLoan.id);

    const vehicleLoan = await loanRepo.findByVehicleId(testVehicle.id);
    console.log('Found vehicle loan:', vehicleLoan?.id);

    // Test insurance operations
    console.log('\n🛡️ Testing Insurance Repository...');
    const testInsurance = await insuranceRepo.create({
      vehicleId: testVehicle.id,
      company: 'Test Insurance Co',
      totalCost: 1200,
      termLengthMonths: 6,
      startDate: new Date(),
      endDate: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000), // 6 months from now
      monthlyCost: 200,
    });
    console.log('Created insurance policy:', testInsurance.id);

    const vehicleInsurance = await insuranceRepo.findByVehicleId(testVehicle.id);
    console.log('Vehicle insurance policies count:', vehicleInsurance.length);

    // Test analytics queries
    console.log('\n📊 Testing Analytics Queries...');
    const categoryTotals = await expenseRepo.getTotalByCategory(testVehicle.id);
    console.log('Category totals:', categoryTotals);

    const monthlyTotals = await expenseRepo.getMonthlyTotals(testVehicle.id, 2024);
    console.log('Monthly totals for 2024:', monthlyTotals);

    console.log('\n✅ All repository tests passed!');
  } catch (error) {
    console.error('❌ Repository test failed:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.main) {
  await testRepositories();
}
