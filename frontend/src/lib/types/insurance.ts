export interface PolicyDetails {
	policyNumber?: string;
	coverageDescription?: string;
	deductibleAmount?: number;
	coverageLimit?: number;
	agentName?: string;
	agentPhone?: string;
	agentEmail?: string;
}

export interface FinanceDetails {
	totalCost?: number;
	monthlyCost?: number;
	premiumFrequency?: string;
	paymentAmount?: number;
}

export interface PolicyTerm {
	id: string;
	startDate: string;
	endDate: string;
	policyDetails: PolicyDetails;
	financeDetails: FinanceDetails;
}

export interface TermVehicleCoverage {
	vehicleIds: string[];
	splitMethod?: 'even' | 'absolute' | 'percentage';
	allocations?: Array<{ vehicleId: string; amount?: number; percentage?: number }>;
}

export interface TermCoverageRow {
	termId: string;
	vehicleId: string;
}

export interface InsurancePolicy {
	id: string;
	company: string;
	isActive: boolean;
	currentTermStart?: string;
	currentTermEnd?: string;
	terms: PolicyTerm[];
	notes?: string;
	vehicleIds: string[];
	termVehicleCoverage: TermCoverageRow[];
	createdAt: string;
	updatedAt: string;
}

export interface CreatePolicyRequest {
	company: string;
	terms: {
		id: string;
		startDate: string;
		endDate: string;
		policyDetails?: PolicyDetails;
		financeDetails?: FinanceDetails;
		vehicleCoverage: TermVehicleCoverage;
	}[];
	notes?: string;
	isActive?: boolean;
}

export interface UpdatePolicyRequest {
	company?: string;
	notes?: string;
	isActive?: boolean;
}

export interface CreateTermRequest {
	id: string;
	startDate: string;
	endDate: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
	vehicleCoverage: TermVehicleCoverage;
}

export interface UpdateTermRequest {
	startDate?: string;
	endDate?: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
	vehicleCoverage?: TermVehicleCoverage;
}
