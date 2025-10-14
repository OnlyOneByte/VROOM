import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { loanPayments } from '../../db/schema.js';
import type { LoanPayment, NewLoanPayment } from '../../db/schema.js';
import type { ILoanPaymentRepository } from './interfaces.js';
import { BaseRepository } from './base.js';

export class LoanPaymentRepository extends BaseRepository<LoanPayment, NewLoanPayment> implements ILoanPaymentRepository {
  constructor() {
    super(loanPayments);
  }

  async findByLoanId(loanId: string): Promise<LoanPayment[]> {
    try {
      const result = await db
        .select()
        .from(loanPayments)
        .where(eq(loanPayments.loanId, loanId))
        .orderBy(desc(loanPayments.paymentDate));
      return result;
    } catch (error) {
      console.error(`Error finding payments for loan ${loanId}:`, error);
      throw new Error('Failed to find payments for loan');
    }
  }

  async findByLoanIdAndDateRange(loanId: string, startDate: Date, endDate: Date): Promise<LoanPayment[]> {
    try {
      const result = await db
        .select()
        .from(loanPayments)
        .where(
          and(
            eq(loanPayments.loanId, loanId),
            gte(loanPayments.paymentDate, startDate),
            lte(loanPayments.paymentDate, endDate)
          )
        )
        .orderBy(desc(loanPayments.paymentDate));
      return result;
    } catch (error) {
      console.error(`Error finding payments for loan ${loanId} in date range:`, error);
      throw new Error('Failed to find payments for date range');
    }
  }

  async getLastPayment(loanId: string): Promise<LoanPayment | null> {
    try {
      const result = await db
        .select()
        .from(loanPayments)
        .where(eq(loanPayments.loanId, loanId))
        .orderBy(desc(loanPayments.paymentDate))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding last payment for loan ${loanId}:`, error);
      throw new Error('Failed to find last payment');
    }
  }

  async getPaymentCount(loanId: string): Promise<number> {
    try {
      const result = await db
        .select({
          count: sql<number>`count(*)`.as('count'),
        })
        .from(loanPayments)
        .where(eq(loanPayments.loanId, loanId));
      
      return Number(result[0]?.count) || 0;
    } catch (error) {
      console.error(`Error getting payment count for loan ${loanId}:`, error);
      throw new Error('Failed to get payment count');
    }
  }
}