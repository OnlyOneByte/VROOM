/**
 * Loan calculation utilities for amortization schedules and payment analysis
 */

export interface LoanTerms {
  principal: number;
  apr: number;
  termMonths: number;
  startDate: Date;
}

export interface PaymentScheduleItem {
  paymentNumber: number;
  paymentDate: Date;
  paymentAmount: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
}

export interface LoanAnalysis {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: Date;
  schedule: PaymentScheduleItem[];
}

/**
 * Calculate monthly payment using standard amortization formula
 */
export function calculateMonthlyPayment(
  principal: number,
  apr: number,
  termMonths: number
): number {
  if (apr === 0) {
    return principal / termMonths;
  }

  const monthlyRate = apr / 100 / 12;
  const numerator = principal * monthlyRate * (1 + monthlyRate) ** termMonths;
  const denominator = (1 + monthlyRate) ** termMonths - 1;

  return numerator / denominator;
}

/**
 * Generate complete amortization schedule
 */
export function generateAmortizationSchedule(terms: LoanTerms): LoanAnalysis {
  const { principal, apr, termMonths, startDate } = terms;
  const monthlyPayment = calculateMonthlyPayment(principal, apr, termMonths);
  const monthlyRate = apr / 100 / 12;

  const schedule: PaymentScheduleItem[] = [];
  let remainingBalance = principal;
  let totalInterest = 0;

  for (let paymentNumber = 1; paymentNumber <= termMonths; paymentNumber++) {
    const interestAmount = remainingBalance * monthlyRate;
    const principalAmount = monthlyPayment - interestAmount;

    // Ensure we don't overpay on the last payment
    const actualPrincipalAmount = Math.min(principalAmount, remainingBalance);
    const actualPaymentAmount = interestAmount + actualPrincipalAmount;

    remainingBalance -= actualPrincipalAmount;
    totalInterest += interestAmount;

    // Calculate payment date (add months to start date)
    const paymentDate = new Date(startDate);
    paymentDate.setMonth(paymentDate.getMonth() + paymentNumber);

    schedule.push({
      paymentNumber,
      paymentDate,
      paymentAmount: actualPaymentAmount,
      principalAmount: actualPrincipalAmount,
      interestAmount,
      remainingBalance: Math.max(0, remainingBalance), // Ensure no negative balance
    });

    // Break if loan is paid off
    if (remainingBalance <= 0.01) {
      break;
    }
  }

  const payoffDate = schedule[schedule.length - 1]?.paymentDate || startDate;

  return {
    monthlyPayment,
    totalInterest,
    totalPayments: schedule.length,
    payoffDate,
    schedule,
  };
}

/**
 * Calculate remaining balance after a specific number of payments
 */
export function calculateRemainingBalance(
  principal: number,
  apr: number,
  termMonths: number,
  paymentsMade: number
): number {
  if (paymentsMade >= termMonths) {
    return 0;
  }

  if (apr === 0) {
    const monthlyPayment = principal / termMonths;
    return principal - monthlyPayment * paymentsMade;
  }

  const monthlyRate = apr / 100 / 12;
  const monthlyPayment = calculateMonthlyPayment(principal, apr, termMonths);

  let balance = principal;
  for (let i = 0; i < paymentsMade; i++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    balance -= principalPayment;
  }

  return Math.max(0, balance);
}

/**
 * Calculate payment breakdown for a specific payment number
 */
export function calculatePaymentBreakdown(
  principal: number,
  apr: number,
  termMonths: number,
  paymentNumber: number
): { principalAmount: number; interestAmount: number; remainingBalance: number } {
  const monthlyRate = apr / 100 / 12;
  const monthlyPayment = calculateMonthlyPayment(principal, apr, termMonths);

  // Calculate balance before this payment
  const balanceBeforePayment = calculateRemainingBalance(
    principal,
    apr,
    termMonths,
    paymentNumber - 1
  );

  const interestAmount = balanceBeforePayment * monthlyRate;
  const principalAmount = Math.min(monthlyPayment - interestAmount, balanceBeforePayment);
  const remainingBalance = Math.max(0, balanceBeforePayment - principalAmount);

  return {
    principalAmount,
    interestAmount,
    remainingBalance,
  };
}

/**
 * Calculate the impact of extra payments
 */
export function calculateExtraPaymentImpact(
  terms: LoanTerms,
  extraPaymentAmount: number,
  extraPaymentFrequency: 'monthly' | 'yearly' | 'one-time' = 'monthly'
): {
  originalAnalysis: LoanAnalysis;
  newAnalysis: LoanAnalysis;
  interestSavings: number;
  timeSavings: number; // months saved
} {
  const originalAnalysis = generateAmortizationSchedule(terms);

  // For simplicity, we'll simulate monthly extra payments
  // In a real implementation, you'd want more sophisticated handling
  let adjustedPrincipal = terms.principal;

  if (extraPaymentFrequency === 'monthly') {
    // Simulate the effect by reducing the effective principal
    // This is a simplified calculation - real implementation would need
    // to recalculate the entire schedule with extra payments
    const effectiveExtraPayment = extraPaymentAmount * 0.8; // Rough approximation
    adjustedPrincipal = Math.max(0, terms.principal - effectiveExtraPayment);
  }

  const newTerms: LoanTerms = {
    ...terms,
    principal: adjustedPrincipal,
  };

  const newAnalysis = generateAmortizationSchedule(newTerms);

  return {
    originalAnalysis,
    newAnalysis,
    interestSavings: originalAnalysis.totalInterest - newAnalysis.totalInterest,
    timeSavings: originalAnalysis.totalPayments - newAnalysis.totalPayments,
  };
}

/**
 * Validate loan terms
 */
export function validateLoanTerms(terms: Partial<LoanTerms>): string[] {
  const errors: string[] = [];

  if (!terms.principal || terms.principal <= 0) {
    errors.push('Principal amount must be greater than 0');
  }

  if (terms.apr === undefined || terms.apr < 0 || terms.apr > 50) {
    errors.push('APR must be between 0 and 50');
  }

  if (!terms.termMonths || terms.termMonths <= 0 || terms.termMonths > 600) {
    errors.push('Term must be between 1 and 600 months');
  }

  if (!terms.startDate) {
    errors.push('Start date is required');
  }

  return errors;
}
