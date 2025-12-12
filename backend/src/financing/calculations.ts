/**
 * Financing Calculations
 * Extracted from lib/services/analytics.ts
 */

export interface LoanTerms {
  principal: number;
  apr: number;
  termMonths: number;
  startDate: Date;
}

export function validateLoanTerms(terms: LoanTerms): string[] {
  const errors: string[] = [];

  if (terms.principal <= 0) {
    errors.push('Principal must be greater than 0');
  }

  if (terms.apr < 0 || terms.apr > 100) {
    errors.push('APR must be between 0 and 100');
  }

  if (terms.termMonths <= 0) {
    errors.push('Term must be at least 1 month');
  }

  return errors;
}

export function calculatePaymentBreakdown(
  principal: number,
  apr: number,
  termMonths: number,
  paymentNumber: number
): {
  principalAmount: number;
  interestAmount: number;
} {
  const monthlyRate = apr / 100 / 12;
  const monthlyPayment =
    (principal * monthlyRate * (1 + monthlyRate) ** termMonths) /
    ((1 + monthlyRate) ** termMonths - 1);

  // Calculate remaining balance before this payment
  const remainingBalance =
    (principal * ((1 + monthlyRate) ** termMonths - (1 + monthlyRate) ** (paymentNumber - 1))) /
    ((1 + monthlyRate) ** termMonths - 1);

  const interestAmount = remainingBalance * monthlyRate;
  const principalAmount = monthlyPayment - interestAmount;

  return {
    principalAmount: Math.max(0, principalAmount),
    interestAmount: Math.max(0, interestAmount),
  };
}

export function generateAmortizationSchedule(terms: LoanTerms): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
  schedule: Array<{
    paymentNumber: number;
    paymentDate: string;
    paymentAmount: number;
    principalAmount: number;
    interestAmount: number;
    remainingBalance: number;
  }>;
} {
  const monthlyRate = terms.apr / 100 / 12;
  const monthlyPayment =
    (terms.principal * monthlyRate * (1 + monthlyRate) ** terms.termMonths) /
    ((1 + monthlyRate) ** terms.termMonths - 1);

  let remainingBalance = terms.principal;
  let totalInterest = 0;
  const schedule = [];

  for (let i = 1; i <= terms.termMonths; i++) {
    const interestAmount = remainingBalance * monthlyRate;
    const principalAmount = monthlyPayment - interestAmount;
    remainingBalance -= principalAmount;
    totalInterest += interestAmount;

    const paymentDate = new Date(terms.startDate);
    paymentDate.setMonth(paymentDate.getMonth() + i);

    schedule.push({
      paymentNumber: i,
      paymentDate: paymentDate.toISOString(),
      paymentAmount: monthlyPayment,
      principalAmount,
      interestAmount,
      remainingBalance: Math.max(0, remainingBalance),
    });
  }

  const payoffDate = new Date(terms.startDate);
  payoffDate.setMonth(payoffDate.getMonth() + terms.termMonths);

  return {
    monthlyPayment,
    totalInterest,
    totalPayments: monthlyPayment * terms.termMonths,
    payoffDate: payoffDate.toISOString(),
    schedule,
  };
}
